/* ============================================================
   CLOUDOVÁ SYNCHRONIZACE  (ES modul)
   Firebase Authentication (Google) + Cloud Firestore
   ------------------------------------------------------------
   • localStorage zůstává zdrojem pravdy → appka je dál offline-first
   • Firebase je jen zrcadlo; při přihlášení se stavy SLUČUJÍ, nikdy
     nepřepisují, aby žádné zařízení nepřišlo o pokrok
   • Bez vyplněného FIREBASE_CONFIG se nic nenačítá (ani CDN)
   ============================================================ */

var SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
var COLLECTION = 'progress';

// Náhodné ID tohoto zařízení – podle něj poznáme vlastní zápisy
// (Firestore posílá zpět i naše vlastní změny) a ignorujeme je.
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

// Načtené části Firebase SDK
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
  try { return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return '—'; }
}

function toast(msg, ms) {
  if (window.S2000 && window.S2000.toast) window.S2000.toast(msg, ms);
}

/* Počkej, až app.js dokončí start (načte words/grammar/verbs). */
function whenAppReady() {
  return new Promise(function (resolve) {
    if (window.appReady) return resolve(window.appReady);
    var tries = 0;
    (function poll() {
      if (window.appReady) return resolve(window.appReady);
      if (tries++ > 100) return resolve();          // ~5 s, pak to vzdáme
      setTimeout(poll, 50);
    })();
  });
}

function describeError(e) {
  var code = (e && e.code) || '';
  var map = {
    'auth/popup-closed-by-user': 'Přihlášení zrušeno (zavřel jsi okno Google).',
    'auth/popup-blocked': 'Prohlížeč zablokoval přihlašovací okno. Povol vyskakovací okna a zkus to znovu.',
    'auth/cancelled-popup-request': 'Přihlášení zrušeno.',
    'auth/unauthorized-domain': 'Tato doména není povolená ve Firebase (Authentication → Settings → Authorized domains).',
    'auth/operation-not-allowed': 'Google přihlášení není ve Firebase zapnuté (Authentication → Sign-in method).',
    'auth/network-request-failed': 'Chyba sítě — zkontroluj připojení.',
    'permission-denied': 'Firestore odmítl přístup — zkontroluj bezpečnostní pravidla (Rules).',
    'unavailable': 'Firestore je nedostupný (offline?).'
  };
  if (map[code]) return map[code];
  return (e && (e.message || e.code)) || 'Neznámá chyba';
}

/* Načte Firebase SDK z CDN. Dynamický import → když jsme offline nebo je
   CDN nedostupné, spadne to do catch a zbytek appky funguje dál. */
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

  try {
    await loadSdk();
    var app = F.app.initializeApp(cfg);
    auth = F.auth.getAuth(app);
    db = F.fs.getFirestore(app);
    provider = new F.auth.GoogleAuthProvider();

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

/* ---------------- Přihlášení / odhlášení ---------------- */
async function signIn() {
  if (!auth) return;
  try {
    status = 'signing-in'; statusMsg = ''; renderPanel();
    await F.auth.signInWithPopup(auth, provider);
    // další kroky řeší onAuthStateChanged
  } catch (e) {
    status = 'error';
    statusMsg = describeError(e);
    renderPanel();
  }
}

async function signOutNow() {
  if (!auth) return;
  try {
    await F.auth.signOut(auth);
    toast('Odhlášeno. Pokrok zůstává v tomto zařízení. 👋');
  } catch (e) {
    toast('Odhlášení se nepovedlo 😕');
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
      // sloučený výsledek hned pošli zpět → všechna zařízení se srovnají
      await pushState(true);
      lastPullAt = Date.now();
      reportMerge(before, after);
      return;
    }
  }
  // v cloudu ještě nic není → nahraj lokální pokrok
  await pushState(true);
  lastPushAt = Date.now();
  lastPullAt = Date.now();
  toast('Pokrok nahrán do cloudu ⬆');
}

/* Shrnutí, co se sloučením změnilo (jen když se něco skutečně změnilo). */
function reportMerge(before, after) {
  var beforeCards = Object.keys(before.cards || {}).length;
  var afterCards = Object.keys(after.cards || {}).length;
  var added = Math.max(0, afterCards - beforeCards);
  var xpDiff = Math.abs((Number(after.xp) || 0) - (Number(before.xp) || 0));

  if (added || xpDiff) {
    var parts = [];
    if (added) parts.push('+' + added + ' slovíček');
    if (xpDiff) parts.push('XP ' + (window.S2000 ? window.S2000.fmt(after.xp) : after.xp));
    toast('Sloučeno s cloudem: ' + parts.join(', ') + ' ✅', 4000);
  } else {
    toast('Pokrok je v pořádku synchronizovaný ✅');
  }
}

function subscribeLive() {
  unsubscribeLive();
  try {
    unsubDoc = F.fs.onSnapshot(docRef(), function (snap) {
      if (!snap.exists()) return;
      var d = snap.data() || {};
      if (d.device === DEVICE_ID) return;            // vlastní zápis → ignoruj
      if (!d.state || !window.S2000) return;

      window.S2000.applyRemote(d.state);
      lastPullAt = Date.now();
      if (!echoToastShown) {
        echoToastShown = true;
        toast('Pokrok se aktualizoval z jiného zařízení 🔄', 3500);
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

/* Každá lokální změna → odložený push do cloudu (2,5 s po poslední změně). */
function hookLocalSave() {
  if (!window.S2000) return;
  window.S2000.onLocalSave = function () {
    if (!user) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushState(true).catch(function () {
        status = 'error';
        statusMsg = 'Nepodařilo se nahrát změny do cloudu.';
        renderPanel();
      });
    }, 2500);
  };
}

/* ---------------- Ruční akce z UI ---------------- */
async function manualPush() {
  try {
    status = 'syncing'; renderPanel();
    await pushState(true);
    status = 'ok';
    toast('Nahráno do cloudu ⬆');
  } catch (e) {
    status = 'error'; statusMsg = describeError(e);
    toast('Nahrání se nepovedlo 😕');
  }
  renderPanel();
}

async function manualPull() {
  try {
    status = 'syncing'; renderPanel();
    var snap = await F.fs.getDoc(docRef());
    if (!snap.exists() || !(snap.data() || {}).state) {
      status = 'ok';
      toast('V cloudu zatím žádný pokrok není.');
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
    toast('Stažení se nepovedlo 😕');
  }
  renderPanel();
}

/* ---------------- Vykreslení panelu v záložce „Víc" ---------------- */
function renderPanel() {
  var box = el('sync-body');
  if (!box) return;
  box.innerHTML = panelHtml();
}

function panelHtml() {
  if (status === 'unconfigured') {
    return '<p class="hint">Cloudová synchronizace zatím není nastavená.</p>' +
      '<p class="hint">Doplň svůj <strong>firebase-config.js</strong> — podrobný postup ' +
      '(Firebase projekt, Google přihlášení, Firestore pravidla) je v komentáři přímo v tom souboru.</p>';
  }

  if (status === 'offline') {
    return '<p class="hint">Jsi offline. Synchronizace se připojí, jakmile budeš na síti — ' +
      'učení funguje i tak dál. 📴</p>';
  }

  if (!user) {
    var err = (status === 'error')
      ? '<p class="hint" style="color:var(--danger)">' + esc(statusMsg) + '</p>' : '';
    var busy = (status === 'signing-in')
      ? '<p class="hint">Přihlašuji…</p>' : '';
    return '<p class="hint">Přihlas se Google účtem a měj stejný pokrok na telefonu i na počítači.</p>' +
      '<button type="button" class="btn btn-primary btn-large" data-sync="signin">' +
      '🔐 Přihlásit se Google účtem</button>' + busy + err +
      '<p class="hint">Pokrok zůstává uložený i v tomto zařízení, přihlášení je jen navíc.</p>';
  }

  var info;
  if (status === 'syncing') info = 'Synchronizuji… ⏳';
  else if (status === 'error') info = '<span style="color:var(--danger)">' + esc(statusMsg) + '</span>';
  else info = 'Synchronizováno ✅';

  return '<p class="hint">Přihlášen jako <strong>' +
      esc(user.email || user.displayName || 'Google účet') + '</strong><br>' +
      info + '<br>' +
      'Nahráno: ' + timeStr(lastPushAt) + ' · Staženo: ' + timeStr(lastPullAt) + '</p>' +
    '<button type="button" class="btn btn-secondary btn-large" data-sync="push">⬆ Nahrát do cloudu</button>' +
    '<button type="button" class="btn btn-secondary btn-large" data-sync="pull">⬇ Stáhnout z cloudu</button>' +
    '<button type="button" class="btn btn-ghost btn-large" data-sync="signout">Odhlásit se</button>' +
    '<p class="hint">Změny se nahrávají automaticky ~2,5 s po každé odpovědi a při zavření appky. ' +
    'Při stažení se pokrok <strong>slučuje</strong>, takže o nic nepřijdeš ani na jednom zařízení.</p>';
}

function onPanelClick(e) {
  var b = e.target && e.target.closest ? e.target.closest('[data-sync]') : null;
  if (!b) return;
  var act = b.getAttribute('data-sync');
  if (act === 'signin') signIn();
  else if (act === 'signout') signOutNow();
  else if (act === 'push') manualPush();
  else if (act === 'pull') manualPull();
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

// Pro ladění z konzole
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
  // testovací simulace: předstírá přihlášeného uživatele a simuluje cloud
  _setUser: function (u) { user = u; status = u ? 'ok' : 'idle'; renderPanel(); },
  _setStatus: function (s, m) { status = s; statusMsg = m || ''; renderPanel(); }
};


