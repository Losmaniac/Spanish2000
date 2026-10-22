/* ============================================================
   CLOUD SYNC  (plain script)
   Firebase Authentication (Google) + Cloud Firestore
   ------------------------------------------------------------
   • localStorage stays the source of truth → the app remains offline-first
   • Firebase is only a mirror; on sign-in the states are MERGED, never
     overwritten, so no device loses progress
   • Without a filled-in FIREBASE_CONFIG nothing is loaded (not even the CDN)
   ============================================================ */

var SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
var COLLECTION = 'progress';

// Random ID of this device — used to recognise our own writes
// (Firestore echoes our own changes back) so we can ignore them.
var DEVICE_ID = (function () {
  try {
    var k = 'es_device_id';
    var v = localStorage.getItem(k);
    if (!v) {
      v = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(k, v);
    }
    return v;
  } catch (e) {
    return 'dev-' + Math.random().toString(36).slice(2);
  }
})();

var cfg = window.FIREBASE_CONFIG || null;

// Loaded Firebase SDK modules
var F = { app: null, auth: null, fs: null };
var auth = null, db = null, provider = null, user = null;

var unsubDoc = null;
var pushTimer = null;
var lastPushAt = 0;
var lastPullAt = 0;
var status = 'init';        // init | unconfigured | offline | signing-in | syncing | ok | error
var statusMsg = '';
var echoToastShown = false;

function $(s) { return document.querySelector(s); }
function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function timeStr(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return '—'; }
}

function toast(msg, ms) {
  if (window.S2000 && window.S2000.toast) window.S2000.toast(msg, ms);
}

/* Wait until app.js finishes starting (loads words/grammar/verbs). */
function whenAppReady() {
  return new Promise(function (resolve) {
    if (window.appReady) return resolve(window.appReady);
    var tries = 0;
    (function poll() {
      if (window.appReady) return resolve(window.appReady);
      if (tries++ > 100) return resolve();          // ~5 s, then give up
      setTimeout(poll, 50);
    })();
  });
}

function describeError(e) {
  var code = (e && e.code) || '';
  var map = {
    'auth/popup-closed-by-user': 'Sign-in cancelled (you closed the Google window).',
    'auth/popup-blocked': 'The browser blocked the sign-in popup. Allow popups and try again.',
    'auth/cancelled-popup-request': 'Sign-in cancelled.',
    'auth/unauthorized-domain': 'This domain is not authorised in Firebase (Authentication → Settings → Authorized domains).',
    'auth/operation-not-allowed': 'Google sign-in is not enabled in Firebase (Authentication → Sign-in method).',
    'auth/network-request-failed': 'Network error — check your connection.',
    'permission-denied': 'Firestore denied access — check the security rules.',
    'unavailable': 'Firestore is unavailable (offline?).'
  };
  if (map[code]) return map[code];

  // Firebase SDK (CDN) load failure — typically in a WebView or on a weak network.
  var msg = (e && e.message) || '';
  if (/module|import|Failed to fetch|NetworkError|Load failed|Network request failed/i.test(msg)) {
    return 'Could not load the Firebase SDK from the CDN (gstatic.com). ' +
      'Check your connection and tap "Try again". ' +
      'If the app is open in a browser inside Instagram, Facebook ' +
      'or Messenger, open it directly in Chrome / Safari instead — in-app ' +
      'browsers often block scripts from other domains.';
  }

  return msg || code || 'Unknown error';
}

/* Loads the Firebase SDK from the CDN. Dynamic import → if we are offline or
   the CDN is unreachable it lands in catch and the rest of the app keeps working. */
async function loadSdk() {
  var appMod = await import(SDK_BASE + 'firebase-app.js');
  var authMod = await import(SDK_BASE + 'firebase-auth.js');
  var fsMod = await import(SDK_BASE + 'firebase-firestore.js');
  F.app = appMod; F.auth = authMod; F.fs = fsMod;
  return true;
}

async function start() {
  renderPanel();

  if (!cfg || !cfg.apiKey) {
    status = 'unconfigured';
    renderPanel();
    return;
  }

  // Already initialised → just retry syncing (we must not add a second
  // onAuthStateChanged listener). Used by the "Try again" button.
  if (auth) {
    if (user) {
      status = 'syncing'; renderPanel();
      try { await pullAndMerge(); subscribeLive(); status = 'ok'; }
      catch (e) { status = 'error'; statusMsg = describeError(e); }
    } else {
      status = 'idle';
    }
    renderPanel();
    return;
  }

  try {
    await loadSdk();
    var app = F.app.initializeApp(cfg);
    auth = F.auth.getAuth(app);
    db = F.fs.getFirestore(app);
    provider = new F.auth.GoogleAuthProvider();

    // Completing sign-in via redirect (mobile / installed PWA)
    F.auth.getRedirectResult(auth).catch(function (e) {
      status = 'error';
      statusMsg = describeError(e);
      renderPanel();
    });

    F.auth.onAuthStateChanged(auth, async function (u) {
      user = u;
      if (u) {
        status = 'syncing';
        renderPanel();
        try {
          await pullAndMerge();
          subscribeLive();
          status = 'ok';
        } catch (e) {
          status = 'error';
          statusMsg = describeError(e);
        }
        renderPanel();
      } else {
        unsubscribeLive();
        status = 'idle';
        renderPanel();
      }
    });

    window.addEventListener('pagehide', function () {
      if (user) { pushState(true).catch(function () {}); }
    });
  } catch (e) {
    status = (navigator.onLine === false) ? 'offline' : 'error';
    statusMsg = describeError(e);
    renderPanel();
  }
}

/* ---------------- Sign in / sign out ---------------- */
// On mobile (especially in an installed PWA) the popup may be blocked.
// In that case we automatically fall back to redirect — the officially
// recommended approach for Android/iOS PWAs.
var REDIRECT_FALLBACK = [
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment'
];

async function signIn() {
  if (!auth) return;
  status = 'signing-in'; statusMsg = ''; renderPanel();

  try {
    await F.auth.signInWithPopup(auth, provider);
    return;                                  // completion is handled by onAuthStateChanged
  } catch (e) {
    var code = (e && e.code) || '';

    if (REDIRECT_FALLBACK.indexOf(code) > -1) {
      try {
        statusMsg = 'Redirecting to Google…';
        renderPanel();
        await F.auth.signInWithRedirect(auth, provider);
        return;                              // the page is left
      } catch (e2) {
        status = 'error'; statusMsg = describeError(e2); renderPanel();
        return;
      }
    }

    status = 'error';
    statusMsg = describeError(e);
    renderPanel();
  }
}

async function signOutNow() {
  if (!auth) return;
  try {
    await F.auth.signOut(auth);
    toast('Signed out. Progress stays on this device. 👋');
  } catch (e) {
    toast('Sign-out failed 😕');
  }
}

/* ---------------- Firestore ---------------- */
function docRef() {
  return F.fs.doc(db, COLLECTION, user.uid);
}

async function pushState(silent) {
  if (!user || !db) return;
  var payload = {
    state: (window.S2000 ? window.S2000.snapshot() : null),
    updatedAt: F.fs.serverTimestamp(),
    device: DEVICE_ID,
    email: user.email || '',
    deviceName: navigator.platform || ''
  };
  await F.fs.setDoc(docRef(), payload, { merge: true });
  lastPushAt = Date.now();
  if (!silent) renderPanel();
}

async function pullAndMerge() {
  var snap = await F.fs.getDoc(docRef());
  if (snap.exists()) {
    var data = snap.data() || {};
    if (data.state && window.S2000) {
      var before = window.S2000.snapshot();
      var after = window.S2000.applyRemote(data.state);
      // push the merged result straight back → all devices converge
      await pushState(true);
      lastPullAt = Date.now();
      reportMerge(before, after);
      return;
    }
  }
  // nothing in the cloud yet → upload the local progress
  await pushState(true);
  lastPushAt = Date.now();
  lastPullAt = Date.now();
  toast('Progress uploaded to the cloud ⬆');
}

/* Summary of what the merge changed (only when something actually changed). */
function reportMerge(before, after) {
  var beforeCards = Object.keys(before.cards || {}).length;
  var afterCards = Object.keys(after.cards || {}).length;
  var added = Math.max(0, afterCards - beforeCards);
  var xpDiff = Math.abs((Number(after.xp) || 0) - (Number(before.xp) || 0));

  if (added || xpDiff) {
    var parts = [];
    if (added) parts.push('+' + added + ' words');
    if (xpDiff) parts.push('XP ' + (window.S2000 ? window.S2000.fmt(after.xp) : after.xp));
    toast('Merged with the cloud: ' + parts.join(', ') + ' ✅', 4000);
  } else {
    toast('Progress is in sync ✅');
  }
}

function subscribeLive() {
  unsubscribeLive();
  try {
    unsubDoc = F.fs.onSnapshot(docRef(), function (snap) {
      if (!snap.exists()) return;
      var d = snap.data() || {};
      if (d.device === DEVICE_ID) return;            // own write → ignore
      if (!d.state || !window.S2000) return;

      window.S2000.applyRemote(d.state);
      lastPullAt = Date.now();
      if (!echoToastShown) {
        echoToastShown = true;
        toast('Progress was updated from another device 🔄', 3500);
        setTimeout(function () { echoToastShown = false; }, 8000);
      }
      renderPanel();
    }, function (e) {
      status = 'error';
      statusMsg = describeError(e);
      renderPanel();
    });
  } catch (e) {
    status = 'error';
    statusMsg = describeError(e);
  }
}

function unsubscribeLive() {
  if (unsubDoc) {
    try { unsubDoc(); } catch (e) { /* ignore */ }
    unsubDoc = null;
  }
}

/* Every local change → debounced push to the cloud (2.5 s after the last change). */
function hookLocalSave() {
  if (!window.S2000) return;
  window.S2000.onLocalSave = function () {
    if (!user) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushState(true).catch(function () {
        status = 'error';
        statusMsg = 'Could not upload changes to the cloud.';
        renderPanel();
      });
    }, 2500);
  };
}

/* ---------------- Manual actions from the UI ---------------- */
async function manualPush() {
  try {
    status = 'syncing'; renderPanel();
    await pushState(true);
    status = 'ok';
    toast('Uploaded to the cloud ⬆');
  } catch (e) {
    status = 'error'; statusMsg = describeError(e);
    toast('Upload failed 😕');
  }
  renderPanel();
}

async function manualPull() {
  try {
    status = 'syncing'; renderPanel();
    var snap = await F.fs.getDoc(docRef());
    if (!snap.exists() || !(snap.data() || {}).state) {
      status = 'ok';
      toast('There is no progress in the cloud yet.');
      renderPanel();
      return;
    }
    var before = window.S2000.snapshot();
    var after = window.S2000.applyRemote(snap.data().state);
    await pushState(true);
    lastPullAt = Date.now();
    status = 'ok';
    reportMerge(before, after);
  } catch (e) {
    status = 'error'; statusMsg = describeError(e);
    toast('Download failed 😕');
  }
  renderPanel();
}

/* ---------------- Rendering the panel in the "More" tab ---------------- */
function renderPanel() {
  var box = el('sync-body');
  if (!box) return;
  box.innerHTML = panelHtml();
}

function panelHtml() {
  if (status === 'unconfigured') {
    return '<p class="hint">Cloud sync is not configured yet.</p>' +
      '<p class="hint">Fill in your <strong>firebase-config.js</strong> — the detailed steps ' +
      '(Firebase project, Google sign-in, Firestore rules) are in a comment inside that file.</p>';
  }

  if (status === 'offline') {
    return '<p class="hint">You are offline. Sync will connect once you are back online — ' +
      'studying keeps working either way. 📴</p>';
  }

  if (!user) {
    var err = (status === 'error')
      ? '<p class="hint" style="color:var(--danger)">' + esc(statusMsg) + '</p>' : '';
    var busy = (status === 'signing-in')
      ? '<p class="hint">Signing in…</p>' : '';
    var retry = '<button type="button" class="btn btn-secondary btn-large" data-sync="retry">🔄 Try again</button>';
    var sdkReady = !!F.app;      // without a loaded SDK there is nothing to sign in with

    if (!sdkReady && status === 'error') {
      return '<p class="hint">Cloud sync could not start ' +
        '(usually a weak connection or a restricted browser).</p>' + err + retry +
        '<p class="hint">Studying keeps working — it just will not sync for now.</p>';
    }

    return '<p class="hint">Sign in with Google and keep the same progress on your phone and computer.</p>' +
      '<button type="button" class="btn btn-primary btn-large" data-sync="signin">' +
      '🔐 Sign in with Google</button>' +
      busy + err +
      (status === 'error' ? retry : '') +
      '<p class="hint">Progress stays saved on this device as well; signing in is optional.</p>';
  }

  var info;
  if (status === 'syncing') info = 'Syncing… ⏳';
  else if (status === 'error') info = '<span style="color:var(--danger)">' + esc(statusMsg) + '</span>';
  else info = 'Synced ✅';

  return '<p class="hint">Signed in as <strong>' +
      esc(user.email || user.displayName || 'Google account') + '</strong><br>' +
      info + '<br>' +
      'Uploaded: ' + timeStr(lastPushAt) + ' · Downloaded: ' + timeStr(lastPullAt) + '</p>' +
    '<button type="button" class="btn btn-secondary btn-large" data-sync="push">⬆ Upload to cloud</button>' +
    '<button type="button" class="btn btn-secondary btn-large" data-sync="pull">⬇ Download from cloud</button>' +
    '<button type="button" class="btn btn-ghost btn-large" data-sync="signout">Sign out</button>' +
    '<p class="hint">Changes upload automatically ~2.5 s after each answer and when the app closes. ' +
    'When downloading, progress is <strong>merged</strong>, so neither device loses anything.</p>';
}

function onPanelClick(e) {
  var b = e.target && e.target.closest ? e.target.closest('[data-sync]') : null;
  if (!b) return;
  var act = b.getAttribute('data-sync');
  if (act === 'signin') signIn();
  else if (act === 'signout') signOutNow();
  else if (act === 'push') manualPush();
  else if (act === 'pull') manualPull();
  else if (act === 'retry') { status = 'init'; statusMsg = ''; start(); }
}

/* ---------------- Start ---------------- */
(async function boot() {
  var box = el('sync-body');
  if (box) box.addEventListener('click', onPanelClick);

  window.addEventListener('online', function () {
    if (status === 'offline' || status === 'error') start();
  });
  window.addEventListener('offline', function () {
    status = 'offline';
    renderPanel();
  });

  await whenAppReady();
  hookLocalSave();
  start();
})();

// Console access for debugging
window.SyncDebug = {
  status: function () { return status; },
  message: function () { return statusMsg; },
  user: function () { return user; },
  deviceId: function () { return DEVICE_ID; },
  configured: function () { return !!(cfg && cfg.apiKey); },
  panelHtml: panelHtml,
  renderPanel: renderPanel,
  signIn: signIn,
  signOut: signOutNow,
  push: manualPush,
  pull: manualPull,
  // test simulation: pretends a user is signed in and fakes the cloud
  _setUser: function (u) { user = u; status = u ? 'ok' : 'idle'; renderPanel(); },
  _setStatus: function (s, m) { status = s; statusMsg = m || ''; renderPanel(); }
};


