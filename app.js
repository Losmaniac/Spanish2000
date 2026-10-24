/* ============================================================
   Spanish 2000 — all application logic (vanilla JS, no build step)
   ============================================================ */
'use strict';

var STORAGE_KEY = 'es_state_v1';
// Days per Leitner box. Boxes 6–7 keep 2,000 mature words from needing ~60 reviews a day.
var INTERVALS = [0, 1, 3, 7, 16, 35, 90, 180];
var MAX_BOX = INTERVALS.length - 1;
var REVIEW_LIMIT = 30;                  // max cards per review session
var QUIZ_EVERY = 5;                     // mini quiz after every 5 new words
var XP_CORRECT = 10;
var XP_WRONG = 2;
var XP_SESSION = 20;

/* ---------------- Utility ---------------- */
function normalize(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// English meaning without the gender note: "The (Feminine)" -> "the"
function enKey(s) {
  return normalize(String(s == null ? '' : s).replace(/\([^)]*\)/g, ' '));
}

function editDistance(a, b) {
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// A small typo in a longer answer (already normalized) should not reset a card to box 0.
function isTypo(input, answer) {
  if (answer.length < 4 || input === answer) return false;
  return editDistance(input, answer) <= (answer.length >= 12 ? 2 : 1);
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// Local date (not UTC) in the form YYYY-MM-DD
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function addDays(dateStr, days) {
  var p = String(dateStr).split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function fmt(n) { return Number(n).toLocaleString('cs-CZ'); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shuffle(arr) {
  var r = arr.slice();
  for (var i = r.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = r[i]; r[i] = r[j]; r[j] = t;
  }
  return r;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------------- Stav ---------------- */
function defaultState() {
  return {
    cards: {},          // { rank: { box, due, seen, ok } }
    situationCards: {}, // phrase-level SRS records from real-life conversations
    xp: 0,
    streak: 0,
    lastDay: '',
    dailyGoal: 20,
    doneToday: 0,
    grammarDone: {},    // { lessonId: "YYYY-MM-DD" completed (older saves: true) }
    lastNewDay: '',     // day the last new-words session was finished (today's plan)
    settings: { tts: true, newPerSession: 10, theme: 'auto' },
    updatedAt: 0        // ms timestamp of the last local change (for sync)
  };
}

var state = defaultState();
var words = [];
var grammar = [];
var verbs = [];
var situations = [];

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var p = JSON.parse(raw);
    var s = defaultState();
    s.cards = p.cards && typeof p.cards === 'object' ? p.cards : {};
    s.situationCards = p.situationCards && typeof p.situationCards === 'object' ? p.situationCards : {};
    s.grammarDone = p.grammarDone && typeof p.grammarDone === 'object' ? p.grammarDone : {};
    s.xp = Number(p.xp) || 0;
    s.streak = Number(p.streak) || 0;
    s.lastDay = typeof p.lastDay === 'string' ? p.lastDay : '';
    s.lastNewDay = typeof p.lastNewDay === 'string' ? p.lastNewDay : '';
    s.dailyGoal = Number(p.dailyGoal) || 20;
    s.doneToday = Number(p.doneToday) || 0;
    s.settings = {
      tts: p.settings && p.settings.tts === false ? false : true,
      newPerSession: Number(p.settings && p.settings.newPerSession) || 10,
      theme: (p.settings && p.settings.theme) || 'auto'
    };
    s.updatedAt = Number(p.updatedAt) || 0;
    state = s;
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
}

// silent = true → do not notify cloud sync (used when writing data
// downloaded from the cloud, to avoid an endless push/pull loop).
function saveState(silent) {
  if (!storageEnabled) return;
  if (!silent) state.updatedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Failed to save state:', e); }
  if (!silent && window.S2000 && typeof window.S2000.onLocalSave === 'function') {
    window.S2000.onLocalSave();
  }
}
/* ---------------- Theme (light / dark) ---------------- */
function systemTheme() {
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function resolvedTheme() {
  var t = state.settings.theme || 'auto';
  return t === 'auto' ? systemTheme() : t;
}
function applyTheme() {
  var r = resolvedTheme();
  document.documentElement.setAttribute('data-theme', r);
  $$('.theme-btn').forEach(function (b) {
    b.textContent = r === 'dark' ? '☀️' : '🌙';
    b.setAttribute('aria-label', r === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    b.title = b.getAttribute('aria-label');
  });
  var sel = $('#set-theme');
  if (sel) sel.value = state.settings.theme || 'auto';
}
function setTheme(t) {
  state.settings.theme = t;
  saveState();
  applyTheme();
}
function toggleTheme() {
  setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
}

/* ---------------- Streak, XP, level ---------------- */
function touchStreak() {
  var today = todayStr();
  if (state.lastDay === today) return;              // already counted today
  if (!state.lastDay) state.streak = 1;             // very first day
  else if (state.lastDay === addDays(today, -1)) state.streak += 1;
  else state.streak = 1;                            // pauza
  state.lastDay = today;
  state.doneToday = 0;
}

function addDailyProgress(count) {
  touchStreak();
  state.doneToday = (state.doneToday || 0) + (Number(count) || 1);
}

function dailyProgress() {
  return state.lastDay === todayStr() ? (Number(state.doneToday) || 0) : 0;
}

function addXP(n) { state.xp += n; }
function level() { return Math.floor(state.xp / 200) + 1; }
function levelPercent() { return Math.round((state.xp % 200) / 200 * 100); }
function xpToNext() { return 200 - (state.xp % 200); }

/* ---------------- SRS (Leitner) ---------------- */
function allCards() {
  return Object.keys(state.cards).map(function (r) {
    var c = state.cards[r];
    return { rank: Number(r), box: c.box || 0, due: c.due || todayStr(), seen: c.seen || 0, ok: c.ok || 0 };
  });
}

function dueCards() {
  var t = todayStr();
  return allCards()
    .filter(function (c) { return c.due <= t; })
    .sort(function (a, b) {
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
      return a.rank - b.rank;
    });
}

function newWordList(limit) {
  var learned = {};
  Object.keys(state.cards).forEach(function (r) { learned[r] = 1; });
  var out = [];
  for (var i = 0; i < words.length && out.length < limit; i++) {
    if (!learned[String(words[i].rank)]) out.push(words[i]);
  }
  return out;
}

function ensureCard(rank) {
  if (!state.cards[rank]) {
    state.cards[rank] = { box: 0, due: todayStr(), seen: 0, ok: 0 };
  }
  return state.cards[rank];
}

// Correct: box = min(box+1, 5), due = today + INTERVALS[box]
function answerCorrect(rank) {
  var c = ensureCard(rank);
  c.seen += 1;
  c.ok += 1;
  c.box = Math.min(c.box + 1, MAX_BOX);
  c.due = addDays(todayStr(), INTERVALS[c.box]);
}

// Wrong: box = 0, due = today
function answerWrong(rank) {
  var c = ensureCard(rank);
  c.seen += 1;
  c.box = 0;
  c.due = todayStr();
}

function learnedCount() { return Object.keys(state.cards).length; }

function coveragePercent() {
  var n = learnedCount();
  if (n >= 2000) return 92.7;
  if (n >= 1000) return 87.8 + (n - 1000) / 1000 * (92.7 - 87.8);
  return n / 1000 * 87.8;
}

function boxCounts() {
  var d = INTERVALS.map(function () { return 0; });
  Object.keys(state.cards).forEach(function (r) {
    var b = state.cards[r].box || 0;
    if (b >= 0 && b <= MAX_BOX) d[b] += 1;
  });
  return d;
}

/* ---------------- TTS (speech synthesis) ---------------- */
var ttsSupported = ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window);
function ttsOn() { return ttsSupported && state.settings.tts !== false; }

// Chrome loads the voice list asynchronously, so without this the very first
// click would find no Spanish voice and stay completely silent.
var ttsVoices = [];
var ttsVoice = null;

function loadVoices() {
  if (!ttsSupported) return;
  try { ttsVoices = window.speechSynthesis.getVoices() || []; }
  catch (e) { ttsVoices = []; }
  var spanish = ttsVoices.filter(function (v) { return /^es([-_]|$)/i.test(v.lang || ''); });
  ttsVoice = spanish.filter(function (v) { return /^es[-_]ES/i.test(v.lang); })[0] ||
             spanish[0] || null;
}

if (ttsSupported) {
  loadVoices();
  if (typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  } else {
    window.speechSynthesis.onvoiceschanged = loadVoices;   // older Safari
  }
}

// Returns true only when something was actually queued for speaking,
// so callers can show a message instead of failing silently.
function speak(text) {
  if (!ttsOn() || !text) return false;
  var synth = window.speechSynthesis;
  try {
    if (!ttsVoices.length) loadVoices();     // voices may have arrived meanwhile

    var u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'es-ES';
    u.rate = 0.9;
    u.pitch = 1;
    if (ttsVoice) { u.voice = ttsVoice; u.lang = ttsVoice.lang || 'es-ES'; }

    if (synth.speaking || synth.pending) {
      // Chrome bug: cancel() followed by speak() in the SAME task drops the
      // utterance. So after cancelling we speak on the next tick instead.
      synth.cancel();
      setTimeout(function () { try { synth.speak(u); } catch (e) { /* ignore */ } }, 90);
    } else {
      // Nothing is speaking → speak synchronously. This is required on iOS,
      // where the utterance must be created inside the user-gesture handler.
      synth.speak(u);
    }
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------- Speech recognition (speaking practice) ---------------- */
var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var recognizer = null;

// Listens for one Spanish reply, puts it in the answer box and checks it.
function startMic(btn) {
  var s = session.steps[session.idx];
  if (!SpeechRec || !s || s.done) return;
  if (recognizer) { recognizer.stop(); return; }   // second tap = stop listening
  var r = recognizer = new SpeechRec();
  r.lang = 'es-ES';
  r.interimResults = false;
  r.maxAlternatives = 5;
  btn.classList.add('listening');
  btn.setAttribute('aria-pressed', 'true');
  r.onresult = function (e) {
    var heard = Array.prototype.map.call(e.results[0], function (a) { return a.transcript; });
    var accepted = [s.answer].concat(s.alternatives || []).map(s.keyFn);
    var best = heard.filter(function (t) { return accepted.indexOf(s.keyFn(t)) !== -1; })[0] || heard[0];
    var inp = $('#session-input');
    if (inp && best && session.steps[session.idx] === s && !s.done) { inp.value = best; handleWriteSubmit(); }
  };
  r.onerror = function (e) {
    toast(e.error === 'not-allowed' || e.error === 'service-not-allowed'
      ? 'Allow microphone access to practise speaking.'
      : 'I didn’t catch that — try again or type it.');
  };
  r.onend = function () {
    recognizer = null;
    btn.classList.remove('listening');
    btn.setAttribute('aria-pressed', 'false');
  };
  try { r.start(); } catch (e) { r.onend(); }
}

/* ---------------- Loading data ---------------- */
function fetchJson(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

// The book's PDF extraction moved the end of ~250 Spanish examples to the start of
// ex_en ("… lo lejos que" / "queda. My problem…"). Move that fragment back.
var SPLIT_TAIL = /^(.+?[.!?…]["”»]?)\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“‘'])/;
function repairExample(w) {
  if (!/^[a-záéíóúñü]/.test(w.ex_en || '')) return w;
  var m = SPLIT_TAIL.exec(w.ex_en);
  if (m) {
    w.ex_es = String(w.ex_es || '').trim() + ' ' + m[1];
    w.ex_en = w.ex_en.slice(m[0].length);
  }
  return w;
}

function loadData() {
  return Promise.all([
    fetchJson('./words.json').then(function (d) { words = Array.isArray(d) ? d.map(repairExample) : []; })
      .catch(function (e) { console.error(e); words = []; }),
    fetchJson('./grammar.json').then(function (d) { grammar = Array.isArray(d) ? d : []; })
      .catch(function (e) { console.error(e); grammar = []; }),
    fetchJson('./verbs.json').then(function (d) { verbs = Array.isArray(d) ? d : []; })
      .catch(function (e) { console.error(e); verbs = []; }),
    fetchJson('./situations.json').then(function (d) { situations = Array.isArray(d) ? d : []; })
      .catch(function (e) { console.error(e); situations = []; })
  ]);
}
/* ---------------- DOM helpers ---------------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

// NOTE: the .hidden property (nor the [hidden] attribute) is not enough —
// our own CSS rules such as .modal{display:flex} or .btn{display:inline-flex}
// override the browser default [hidden]{display:none}. So we also set an
// inline display, which is the strongest and works even with a stale CSS cache.
function hide(el) {
  if (!el) return;
  el.setAttribute('hidden', '');
  el.style.display = 'none';
}
function show(el) {
  if (!el) return;
  el.removeAttribute('hidden');
  el.style.display = '';
}

var toastTimer = null;
function toast(msg, ms) {
  var t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  show(t);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { hide(t); }, ms || 2400);
}

function openModal(html) {
  var m = $('#modal');
  if (!m) return;
  $('#modal-content').innerHTML = html;
  show(m);
  var close = $('#modal .modal-close');
  if (close) close.focus();
}
function closeModal() {
  var m = $('#modal');
  if (!m) return;
  hide(m);
  clear($('#modal-content'));
}
function clear(el) { if (el) el.innerHTML = ''; }

/* ---------------- Tab switching ---------------- */
var TAB_NAMES = ['home', 'learn', 'grammar', 'verbs', 'more'];

function showTab(name) {
  TAB_NAMES.forEach(function (t) {
    var panel = document.getElementById('tab-' + t);
    if (!panel) return;
    if (t === name) { panel.classList.add('active'); show(panel); }
    else { panel.classList.remove('active'); hide(panel); }
  });
  $$('.nav-btn').forEach(function (b) {
    var on = (b.id === 'btn-' + name);
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  if (name === 'home') renderHome();
  else if (name === 'learn') renderLearnStart();
  else if (name === 'grammar') renderGrammar();
  else if (name === 'verbs') renderVerbs();
  else if (name === 'more') renderMore();

  window.scrollTo(0, 0);
}

function greetingText() {
  var h = new Date().getHours();
  if (h < 10) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/* ---------------- Home ---------------- */
function renderHome() {
  var g = $('#greeting');
  if (g) g.textContent = greetingText() + '! 👋';

  setText('#streak-value', fmt(state.streak));
  setText('#xp-value', fmt(state.xp) + ' XP');
  setText('#level-value', fmt(level()));
  setText('#goal-value', fmt(dailyProgress()) + ' / ' + fmt(state.dailyGoal));
  renderPlan();

  var lp = $('#level-fill');
  if (lp) lp.style.width = levelPercent() + '%';
  setText('#level-caption', 'Level ' + level() + ' • ' + fmt(xpToNext()) + ' XP to next');

  var due = dueCards();
  var dueShown = Math.min(due.length, REVIEW_LIMIT);
  var newAvail = newWordList(10000).length;
  var newPlanned = Math.min(state.settings.newPerSession, newAvail);

  setText('#review-count', fmt(dueShown));
  setText('#new-count', fmt(newPlanned));
  setText('#review-desc', due.length ? '(' + fmt(due.length) + ')' : '(0)');
  setText('#new-desc', newPlanned ? '(' + newPlanned + ')' : '(0)');

  var btnReview = $('#btn-review');
  if (btnReview) btnReview.disabled = due.length === 0;
  var btnNew = $('#btn-new');
  if (btnNew) btnNew.disabled = newPlanned === 0;

  setText('#learned-count', fmt(learnedCount()));
  setText('#coverage-percent', coveragePercent().toFixed(1) + '%');

  // Distribution across boxes
  var box = $('#box-distribution');
  var legend = $('#box-legend');
  if (box && legend) {
    var counts = boxCounts();
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    clear(box); clear(legend);
    if (!total) {
      var empty = document.createElement('div');
      empty.className = 'box-seg';
      empty.style.width = '100%';
      empty.style.background = 'var(--border)';
      box.appendChild(empty);
    } else {
      counts.forEach(function (c, i) {
        if (!c) return;
        var seg = document.createElement('div');
        seg.className = 'box-seg';
        seg.setAttribute('data-box', String(i));
        seg.style.width = (c / total * 100) + '%';
        seg.title = 'Box ' + i + ': ' + c;
        box.appendChild(seg);

        var li = document.createElement('span');
        li.innerHTML = '<i style="background:' + boxColor(i) + '"></i>Box ' + i + ': ' + c;
        legend.appendChild(li);
      });
    }
  }
}

/* ---------------- Today's plan: one guided path through the day ---------------- */
function situationKeys(sit) {
  return (sit.turns || []).map(function (_, i) { return sit.id + ':' + i; });
}

// A due conversation first, then the first one not fully practised, else the first.
function planSituation() {
  var list = orderedSituations();
  return list.filter(function (sit) {
    return situationKeys(sit).some(function (k) { return situationCardIsDue(state.situationCards[k]); });
  })[0] || list.filter(function (sit) {
    return !situationKeys(sit).every(function (k) { return state.situationCards[k]; });
  })[0] || list[0] || null;
}

function planLesson() {
  var open = grammar.filter(function (l) { return !state.grammarDone[l.id]; });
  return open.filter(function (l) { return GRAMMAR_CORE_IDS[l.id]; })[0] || open[0] || null;
}

function todayPlan() {
  var t = todayStr();
  var due = dueCards().length;
  var upcoming = newWordList(state.settings.newPerSession || 10);
  var sit = planSituation();
  var lesson = planLesson();
  var talked = Object.keys(state.situationCards || {}).some(function (k) {
    return state.situationCards[k].rewardedDay === t;
  });
  var studied = Object.keys(state.grammarDone || {}).some(function (k) { return state.grammarDone[k] === t; });
  var newDone = state.lastNewDay === t || !upcoming.length;
  return [
    { id: 'review', done: due === 0,
      title: due ? 'Review ' + fmt(Math.min(due, REVIEW_LIMIT)) + ' words' : 'Review words',
      detail: due ? 'Recall them just before you would forget' : 'Nothing due — your memory is up to date',
      run: function () { showTab('learn'); startSession('review'); } },
    { id: 'new', done: newDone,
      title: upcoming.length && !newDone ? 'Learn ' + upcoming.length + ' new words' : 'New words',
      detail: newDone ? (upcoming.length ? 'Done for today ✓' : 'You have met every word 🎉')
        : 'Next up: ' + upcoming.slice(0, 3).map(function (w) { return String(w.es).toLowerCase(); }).join(', ') + '…',
      run: function () { showTab('learn'); startSession('new'); } },
    { id: 'talk', done: talked || !sit,
      title: sit && !talked ? 'Talk: ' + sit.title : 'Conversation',
      detail: talked ? 'Done for today ✓' : (sit ? 'Say ' + sit.turns.length + ' real replies out loud' : ''),
      run: function () { if (sit) { showTab('learn'); startSession('situation', sit.id); } } },
    { id: 'grammar', done: studied || !lesson,
      title: lesson && !studied ? 'Grammar: ' + lesson.title : 'Grammar lesson',
      detail: studied ? 'Done for today ✓' : (lesson ? 'Short explanation, then practice' : 'Every lesson complete 🎉'),
      run: function () { if (lesson) openLesson(lesson.id); } }
  ];
}

var planSteps = [];

function renderPlan() {
  var list = $('#plan-list');
  if (!list) return;
  planSteps = todayPlan();
  var next = planSteps.filter(function (p) { return !p.done; })[0];
  list.innerHTML = planSteps.map(function (p) {
    return '<li><button type="button" class="plan-step' + (p.done ? ' done' : '') + (p === next ? ' next' : '') +
      '" data-act="plan" data-step="' + p.id + '" aria-label="' + esc(p.title + '. ' + p.detail + (p.done ? '. Done.' : '')) + '">' +
      '<span class="plan-check" aria-hidden="true">' + (p.done ? '✓' : '') + '</span>' +
      '<span class="plan-text"><span class="plan-title">' + esc(p.title) + '</span>' +
      '<span class="plan-detail">' + esc(p.detail) + '</span></span></button></li>';
  }).join('');
  var doneN = planSteps.length - planSteps.filter(function (p) { return !p.done; }).length;
  setText('#plan-count', doneN + ' / ' + planSteps.length + ' done');
  setText('#plan-next-label', next ? 'Start: ' + next.title : 'Plan complete 🎉 One more conversation?');
}

function runPlanStep(id) {
  var step = planSteps.filter(function (p) { return p.id === id; })[0];
  if (step) { step.run(); return; }
  showTab('learn');                         // plan complete → let them pick a conversation
  var section = $('.situations-section');
  if (section && section.scrollIntoView) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function boxColor(i) {
  return ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7'][i] || 'var(--border)';
}

function setText(sel, text) {
  var el = $(sel);
  if (el) el.textContent = text;
}
/* ============================================================
   PRACTICE — phases, steps and SRS
   ============================================================ */

/* Splitting the example sentence so we can highlight / blank the target word */
function splitTokens(text) { return String(text || '').split(/(\s+)/); }

function findWordInExample(exEs, esWord) {
  var tokens = splitTokens(exEs);
  var target = normalize(esWord);
  if (!target || !String(exEs || '').trim()) return { found: false, tokens: tokens, index: -1 };
  for (var i = 0; i < tokens.length; i++) {
    if (!tokens[i].trim()) continue;
    var cleaned = tokens[i].replace(/[.,;:!?¡¿"«»()…]/g, '');
    if (cleaned && normalize(cleaned) === target) return { found: true, tokens: tokens, index: i };
  }
  return { found: false, tokens: tokens, index: -1 };
}

function exampleEsHtml(word, blank) {
  var ex = word.ex_es || '';
  var f = findWordInExample(ex, word.es);
  if (!f.found) return esc(ex);
  return f.tokens.map(function (tok, i) {
    if (i !== f.index) return esc(tok);
    return '<mark>' + (blank ? '____' : esc(tok)) + '</mark>';
  }).join('');
}

/* Distractors from a nearby rank (±30), otherwise from the whole list */
function distractorList(word, count, field) {
  var isEn = field === 'en';
  var keyOf = isEn ? enKey : normalize;
  var valOf = function (w) { return isEn ? w.en : String(w.es).toLowerCase(); };
  var used = {}; used[keyOf(valOf(word))] = 1;

  var near = [], far = [];
  words.forEach(function (w) {
    if (w.rank === word.rank) return;
    var v = valOf(w);
    var k = keyOf(v);
    if (!k || used[k]) return;
    if (Math.abs(w.rank - word.rank) <= 30) near.push(w); else far.push(w);
  });

  var pool = shuffle(near).concat(shuffle(far));
  var out = [];
  for (var i = 0; i < pool.length && out.length < count; i++) {
    var v2 = valOf(pool[i]);
    var k2 = keyOf(v2);
    if (!k2 || used[k2]) continue;
    used[k2] = 1;
    out.push(v2);
  }
  return out;
}

function stepIntro(w) {
  return { type: 'intro', rank: w.rank, label: 'Introduction', word: w };
}

function stepChoiceEsEn(w, label) {
  return {
    type: 'choice', rank: w.rank, label: label, word: w,
    big: String(w.es).toLowerCase(), sub: 'Pick the correct meaning',
    options: shuffle([w.en].concat(distractorList(w, 3, 'en'))),
    answer: w.en, keyFn: enKey
  };
}

function stepWriteEnEs(w, label) {
  return {
    type: 'write', rank: w.rank, label: label, word: w,
    big: w.en, sub: 'Write it in Spanish',
    answer: String(w.es).toLowerCase(), keyFn: normalize
  };
}

function stepFill(w, label) {
  if (!findWordInExample(w.ex_es || '', w.es).found) return null;
  return {
    type: 'choice', rank: w.rank, label: label, word: w, fill: true,
    sub: 'Fill in the missing word',
    options: shuffle([String(w.es).toLowerCase()].concat(distractorList(w, 3, 'es'))),
    answer: String(w.es).toLowerCase(), keyFn: normalize
  };
}

function stepListen(w, label) {
  if (!ttsOn()) return null;
  return {
    type: 'listen', rank: w.rank, label: label, word: w,
    sub: 'Listen and pick the correct meaning', speak: w.es,
    options: shuffle([w.en].concat(distractorList(w, 3, 'en'))),
    answer: w.en, keyFn: enKey
  };
}

// Hear the whole example sentence, type the missing word: listening + spelling in context.
function stepDictation(w, label) {
  if (!ttsOn() || !findWordInExample(w.ex_es || '', w.es).found) return null;
  return {
    type: 'write', dictation: true, rank: w.rank, label: label, word: w,
    sub: 'Listen and type the missing word', speak: w.ex_es,
    answer: String(w.es).toLowerCase(), keyFn: normalize
  };
}

function findWordByRank(rank) {
  for (var i = 0; i < words.length; i++) if (words[i].rank === rank) return words[i];
  return null;
}

function findSituation(id) {
  for (var i = 0; i < situations.length; i++) if (situations[i].id === id) return situations[i];
  return null;
}

function normalizePhrase(s) {
  return normalize(s).replace(/[.,;:!?¡¿…'"“”‘’]/g, '').replace(/\s+/g, ' ').trim();
}

function situationCardIsDue(card) {
  return !!(card && card.due && card.due <= todayStr() && card.rewardedDay !== todayStr());
}

function situationDueDate(situation) {
  var due = [];
  (situation.turns || []).forEach(function (_, i) {
    var card = state.situationCards[situation.id + ':' + i];
    if (card && card.due && (card.due > todayStr() || card.rewardedDay !== todayStr())) due.push(card.due);
  });
  if (!due.length) return '';
  due.sort();
  return due[0];
}

// Due phrases first, then the original (easiest-first) order.
function orderedSituations() {
  return situations.slice().sort(function (a, b) {
    var ad = situationDueDate(a), bd = situationDueDate(b);
    var ar = (a.turns || []).some(function (_, i) { return situationCardIsDue(state.situationCards[a.id + ':' + i]); });
    var br = (b.turns || []).some(function (_, i) { return situationCardIsDue(state.situationCards[b.id + ':' + i]); });
    if (ar !== br) return ar ? -1 : 1;
    if (ar && br && ad !== bd) return ad < bd ? -1 : 1;
    return situations.indexOf(a) - situations.indexOf(b);
  });
}

function renderSituationList() {
  var list = $('#situation-list');
  if (!list) return;
  if (!situations.length) {
    list.innerHTML = '<div class="situation-empty">Conversation practice could not be loaded. Check that situations.json is available, then refresh the app.</div>';
    return;
  }
  list.innerHTML = orderedSituations().map(function (situation) {
    var due = situationDueDate(situation);
    var dueNow = (situation.turns || []).some(function (_, i) {
      return situationCardIsDue(state.situationCards[situation.id + ':' + i]);
    });
    var practiced = (situation.turns || []).filter(function (_, i) {
      return !!state.situationCards[situation.id + ':' + i];
    }).length;
    var isComplete = practiced === (situation.turns || []).length;
    var allPractisedToday = isComplete && (situation.turns || []).every(function (_, i) {
      return state.situationCards[situation.id + ':' + i].rewardedDay === todayStr();
    });
    var stateLabel = dueNow ? 'PHRASES DUE' : (allPractisedToday ? 'PRACTISED TODAY' : (isComplete ? 'IN PROGRESS' : (practiced ? 'CONTINUE' : 'NEW')));
    var next = dueNow ? 'Review phrases' : (allPractisedToday ? (due ? 'Next review ' + due : 'Reviewed today') :
      (due ? 'Next review ' + due : (practiced ? 'Continue · ' + practiced + ' of ' + situation.turns.length : situation.turns.length + ' short replies')));
    return '<button type="button" class="situation-card" data-act="situation-start" data-id="' + esc(situation.id) + '">' +
      '<span class="situation-card-top"><span class="situation-title">' + esc(situation.title) + '</span>' +
      '<span class="situation-state' + (dueNow ? ' due' : '') + '">' + stateLabel + '</span></span>' +
      '<span class="situation-setting">' + esc(situation.setting || '') + '</span>' +
      '<span class="situation-goal">' + esc(situation.goal || '') + '</span>' +
      '<span class="situation-card-bottom"><span>' + esc(next) + ' · ' + esc(String(situation.turns.length)) + ' turns</span>' +
      '<span class="situation-level">' + esc(situation.level || 'A1') + '　→</span></span>' +
      '</button>';
  }).join('');
}

var session = {
  active: false, mode: null, steps: [], baseTotal: 0, idx: 0,
  results: {}, skipped: {}, counted: {}, requeued: {}, hints: {},
  correct: 0, wrong: 0, xp: 0, finished: false, situationId: null, rewardEligible: true
};

function buildNewSteps() {
  var list = newWordList(state.settings.newPerSession || 10);
  if (!list.length) return null;
  var steps = [];
  for (var i = 0; i < list.length; i += QUIZ_EVERY) {
    var chunk = list.slice(i, i + QUIZ_EVERY);
    chunk.forEach(function (w) { steps.push(stepIntro(w)); });
    chunk.forEach(function (w) { steps.push(stepChoiceEsEn(w, 'Mini quiz')); });
  }
  list.forEach(function (w) { steps.push(stepWriteEnEs(w, 'Final round')); });
  return steps;
}

function buildReviewSteps() {
  var due = dueCards().slice(0, REVIEW_LIMIT);
  if (!due.length) return null;
  var steps = [];
  due.forEach(function (c) {
    var w = findWordByRank(c.rank);
    if (!w) return;
    // Young cards: recognise it. Settled cards: produce it (harder recall sticks longer).
    var modes = c.box <= 1 ? ['es-en', 'listen', 'fill'] : ['en-es', 'fill', 'dictation', 'listen'];
    var builders = { 'es-en': stepChoiceEsEn, 'en-es': stepWriteEnEs, fill: stepFill, listen: stepListen, dictation: stepDictation };
    var st = null;
    shuffle(modes).some(function (m) { st = builders[m](w, 'Review'); return !!st; });
    steps.push(st || stepChoiceEsEn(w, 'Review'));
  });
  return steps;
}

function buildSituationSteps(id) {
  var situation = findSituation(id);
  if (!situation || !Array.isArray(situation.turns)) return null;
  return situation.turns.map(function (turn, i) {
    var phrase = String(turn.answer || '').trim();
    var firstWords = phrase.split(/\s+/).slice(0, 2).join(' ');
    return {
      type: 'dialogue', rank: situation.id + ':' + i, label: situation.title,
      situation: situation, partner: turn.partner, prompt: turn.prompt,
      speak: /^\[/.test(turn.partner) ? '' : turn.partner,   // "[They repeat…]" is a stage direction, not Spanish
      hint: firstWords + (phrase.split(/\s+/).length > 2 ? '…' : ''),
      meaning: turn.meaning || '', note: turn.note || '', alternatives: turn.alternatives || [],
      word: { es: phrase, en: turn.meaning || '' }, answer: phrase, keyFn: normalizePhrase
    };
  });
}

function startSession(mode, situationId) {
  var steps = mode === 'review' ? buildReviewSteps() :
    (mode === 'situation' ? buildSituationSteps(situationId) : buildNewSteps());
  if (!steps || !steps.length) {
    toast(mode === 'review' ? 'Nothing to review right now 🎉' :
      (mode === 'situation' ? 'This conversation is not available right now.' : 'You have learned every word 🎉'));
    return;
  }
  session.active = true;
  session.finished = false;
  session.mode = mode;
  session.situationId = situationId || null;
  session.rewardEligible = mode !== 'situation' || steps.some(function (step) {
    var card = state.situationCards[step.rank];
    return (!card || !card.due || card.due <= todayStr()) && (!card || card.rewardedDay !== todayStr());
  });
  session.steps = steps;
  session.baseTotal = steps.length;
  session.idx = 0;
  session.results = {};
  session.skipped = {};
  session.counted = {};
  session.requeued = {};
  session.hints = {};
  session.correct = 0;
  session.wrong = 0;
  session.xp = 0;

  hide($('#session-start'));
  hide($('#session-summary'));
  show($('#session-active'));
  show($('#btn-end-session'));
  renderStep();
}
/* ---------------- Rendering one step ---------------- */
function advanceSkipped() {
  while (session.idx < session.steps.length && session.skipped[session.steps[session.idx].rank]) {
    session.idx += 1;
  }
}

function renderStep() {
  advanceSkipped();
  if (session.idx >= session.steps.length) { finishSession(); return; }

  var s = session.steps[session.idx];
  var done = Math.min(session.idx, session.baseTotal);
  var total = session.baseTotal || session.steps.length;

  var fillEl = $('#session-progress-fill');
  if (fillEl) fillEl.style.width = Math.round(done / total * 100) + '%';
  setText('#session-progress-label', s.label === 'Quick retry'
    ? 'Reviewing missed phrases'
    : Math.min(done + 1, total) + ' / ' + total);
  setText('#phase-indicator', s.label || '');

  hide($('#feedback'));
  hide($('#btn-next'));

  var cardEl = $('#card-container');
  var ansEl = $('#answer-area');
  if (cardEl) cardEl.classList.toggle('conversation-card', s.type === 'dialogue');
  cardEl.innerHTML = cardHtml(s);
  ansEl.innerHTML = answerHtml(s);

  if (s.type === 'write' || s.type === 'dialogue') {
    var inp = $('#session-input');
    if (inp) inp.focus();
  }
  if (s.speak) speak(s.speak);
  else if (s.type === 'intro') speak(s.word.es);
}

// After an answer, show the word inside its example sentence (replacing a blanked one).
function revealContext(s) {
  var card = $('#card-container');
  if (!card || !s.word || !s.word.ex_es) return;
  var blank = (s.fill || s.dictation) && $('.card-example', card);
  if (blank) blank.outerHTML = exampleBlockHtml(s.word);
  else card.insertAdjacentHTML('beforeend', exampleBlockHtml(s.word));
}

function speakerBtn(text, label) {
  if (!ttsOn() || !text) return '';
  return ' <button type="button" class="speaker-btn" data-act="speak" data-text="' + esc(text) +
    '" aria-label="' + esc(label) + '" title="' + esc(label) + '">🔊</button>';
}

// The word in its sentence, with audio for the whole sentence — shown when meeting a word and after every answer.
function exampleBlockHtml(w) {
  return '<div class="card-example">' +
    '<div class="es">' + exampleEsHtml(w, false) + speakerBtn(w.ex_es, 'Play the sentence') + '</div>' +
    '<div class="en">' + esc(w.ex_en || '') + '</div>' +
  '</div>';
}

function cardHtml(s) {
  var w = s.word;

  if (s.type === 'dialogue') {
    return '<div class="conversation-kicker">' + esc(s.situation.title) + ' · YOUR TURN</div>' +
      '<div class="conversation-partner"><div class="conversation-partner-label">THE OTHER PERSON</div>' +
      '<div class="conversation-partner-line">' + esc(s.partner) + speakerBtn(s.speak, 'Hear it again') + '</div></div>' +
      '<p class="conversation-cue">' + esc(s.prompt) + '</p>';
  }

  if (s.type === 'intro') {
    return '<div class="card-word">' + esc(String(w.es).toLowerCase()) + speakerBtn(w.es, 'Play the word') + '</div>' +
      '<div class="card-sub">' + esc(w.en) + '</div>' +
      exampleBlockHtml(w);
  }

  if (s.dictation) {
    return '<div class="card-sub">' + esc(s.sub) + '</div>' +
      '<div class="card-example"><div class="es">' + exampleEsHtml(w, true) + speakerBtn(w.ex_es, 'Play the sentence again') + '</div>' +
      '<div class="en">' + esc(w.ex_en || '') + '</div></div>';
  }

  if (s.type === 'listen') {
    var replay = ttsOn()
      ? '<button type="button" class="btn btn-ghost" data-act="speak" data-text="' + esc(s.speak) + '">🔊 Play again</button>'
      : '';
    return '<div class="card-word">🔊</div>' +
      '<div class="card-sub">' + esc(s.sub) + '</div>' +
      '<div style="text-align:center;margin-top:12px">' + replay + '</div>';
  }

  if (s.fill) {
    return '<div class="card-sub">' + esc(s.sub) + '</div>' +
      '<div class="card-example"><div class="es">' + exampleEsHtml(w, true) + '</div></div>';
  }

  return '<div class="card-word">' + esc(s.big) + '</div>' +
    '<div class="card-sub">' + esc(s.sub) + '</div>';
}

function answerHtml(s) {
  if (s.type === 'intro') {
    return '<button type="button" class="btn btn-primary btn-large" data-act="know">✔ I know this</button>' +
      '<button type="button" class="btn btn-ghost btn-large" data-act="continue">📖 Study it</button>';
  }

  if (s.type === 'write') {
    return '<div class="input-group">' +
      '<input type="text" id="session-input" autocomplete="off" autocorrect="off" ' +
      'autocapitalize="off" spellcheck="false" placeholder="write it in Spanish" aria-label="Your answer">' +
      '<button type="button" class="btn btn-primary" data-act="submit">Submit</button>' +
      '</div>';
  }

  if (s.type === 'dialogue') {
    var mic = SpeechRec
      ? '<button type="button" class="btn btn-mic" data-act="mic" aria-pressed="false" aria-label="Say your reply out loud" title="Say it out loud">🎤</button>'
      : '';
    return '<div class="conversation-actions"><span class="hint">' +
      (SpeechRec ? 'Say it out loud 🎤 or type it.' : 'Try to recall the whole phrase first.') + '</span>' +
      '<button type="button" class="hint-action" data-act="show-hint">Need a hint?</button></div>' +
      '<p class="conversation-hint" id="conversation-hint" hidden>Starts with: <strong>' + esc(s.hint) + '</strong></p>' +
      '<div class="input-group"><input type="text" id="session-input" autocomplete="off" autocorrect="off" ' +
      'autocapitalize="off" spellcheck="false" lang="es" placeholder="Your reply in Spanish" aria-label="Write your reply in Spanish">' +
      mic + '<button type="button" class="btn btn-primary" data-act="submit">Check</button></div>';
  }

  var html = '<div class="options-grid">';
  for (var i = 0; i < s.options.length; i++) {
    html += '<button type="button" class="option-btn" data-act="option" data-index="' + i + '">' +
      esc(s.options[i]) + '</button>';
  }
  return html + '</div>';
}
/* ---------------- Answer evaluation ---------------- */
function showFeedback(kind, text) {
  var el = $('#feedback');
  if (!el) return;
  el.className = 'feedback ' + kind;
  el.textContent = text;
  show(el);
}

function recordAnswer(s, ok) {
  var r = session.results[s.rank] || (session.results[s.rank] = { ok: 0, bad: 0 });
  var phraseCard = session.mode === 'situation' && state.situationCards[s.rank];
  var rewardPhrase = session.mode !== 'situation' || !phraseCard ||
    ((!phraseCard.due || phraseCard.due <= todayStr()) && phraseCard.rewardedDay !== todayStr());
  if (ok) {
    r.ok += 1;
    session.correct += 1;
    if (rewardPhrase && !(session.mode === 'situation' && session.hints[s.rank])) session.xp += XP_CORRECT;
  }
  else { r.bad += 1; session.wrong += 1; if (rewardPhrase) session.xp += XP_WRONG; }

  if (!ok) requeueCard(s.rank);

  var remaining = false;
  for (var i = session.idx + 1; i < session.steps.length; i++) {
    if (session.steps[i].rank === s.rank) { remaining = true; break; }
  }
  if (!remaining) applySrs(s.rank);

  var last = (session.idx + 1 >= session.steps.length) && !remaining;
  setText('#btn-next', last ? 'Finish' : 'Next');
  show($('#btn-next'));
  $('#btn-next').scrollIntoView({ block: 'nearest', behavior: 'smooth' });   // the context sentence can push it below the fold
}

function requeueCard(rank) {
  if (session.requeued[rank]) return;
  if (session.mode === 'situation') {
    var current = session.steps[session.idx];
    if (!current) return;
    session.requeued[rank] = 1;
    var retry = Object.assign({}, current, { done: false, label: 'Quick retry' });
    session.steps.push(retry);
    return;
  }
  var w = findWordByRank(rank);
  if (!w) return;
  session.requeued[rank] = 1;
  session.steps.push(stepChoiceEsEn(w, 'Again'));
}

function applySrs(rank) {
  var r = session.results[rank];
  if (!r) return;
  if (session.mode === 'situation') {
    if (!state.situationCards) state.situationCards = {};
    var phraseCard = state.situationCards[rank] || (state.situationCards[rank] = {
      box: 0, due: todayStr(), seen: 0, ok: 0
    });
    var phraseDue = !phraseCard.due || phraseCard.due <= todayStr();
    var phraseReviewEligible = phraseDue && phraseCard.rewardedDay !== todayStr();
    if (phraseReviewEligible) {
      phraseCard.seen += 1;
      phraseCard.rewardedDay = todayStr();
      if (r.ok > r.bad && !session.hints[rank]) {
        phraseCard.ok += 1;
        phraseCard.box = Math.min((Number(phraseCard.box) || 0) + 1, MAX_BOX);
        phraseCard.due = addDays(todayStr(), INTERVALS[phraseCard.box]);
      } else {
        phraseCard.box = 0;
        phraseCard.due = todayStr();
      }
    }
  } else {
    ensureCard(rank);
    if (r.ok > r.bad) answerCorrect(rank);
    else answerWrong(rank);
  }
  if (!session.counted[rank]) {
    session.counted[rank] = 1;
    if (session.mode !== 'situation' || phraseReviewEligible) addDailyProgress(1);
  }
  saveState();
}

function handleOptionClick(index) {
  var s = session.steps[session.idx];
  if (!s || s.done) return;
  var buttons = $$('#answer-area .option-btn');
  if (!buttons.length || !buttons[index]) return;
  s.done = true;

  var ok = s.keyFn(s.options[index]) === s.keyFn(s.answer);
  buttons.forEach(function (b, i) {
    b.disabled = true;
    if (s.keyFn(s.options[i]) === s.keyFn(s.answer)) b.classList.add('correct');
    if (i === index && !ok) b.classList.add('wrong');
  });

  if (ok) showFeedback('correct', 'Correct! 🎉');
  else showFeedback('wrong', 'Wrong — correct answer: ' + s.answer);
  if (ttsOn()) speak(s.word.es);
  revealContext(s);

  recordAnswer(s, ok);
}

function handleWriteSubmit() {
  var s = session.steps[session.idx];
  if (!s || s.done) return;
  var inp = $('#session-input');
  if (!inp) return;
  if (!normalize(inp.value)) { inp.focus(); return; }
  s.done = true;

  var normalizedInput = s.keyFn(inp.value);
  var accepted = [s.answer].concat(s.alternatives || []).map(s.keyFn);
  var typo = accepted.indexOf(normalizedInput) === -1 &&
    accepted.some(function (answer) { return isTypo(normalizedInput, answer); });
  var ok = typo || accepted.indexOf(normalizedInput) !== -1;
  inp.disabled = true;
  inp.classList.add(ok ? 'correct' : 'wrong');

  if (s.type === 'dialogue') {
    if (typo) showFeedback('correct', 'Almost! Watch the spelling: ' + s.answer + ' — ' + s.meaning);
    else if (ok) showFeedback('correct', 'Good recall! ' + s.answer + ' — ' + s.meaning);
    else showFeedback('wrong', 'Try this natural reply: ' + s.answer + ' — ' + s.meaning);
    var card = $('#card-container');
    if (card && s.note) {
      var note = document.createElement('p');
      note.className = 'conversation-note';
      note.textContent = s.note;
      card.appendChild(note);
    }
    if (card && ttsOn()) {
      var replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'btn btn-ghost conversation-replay';
      replay.setAttribute('data-act', 'speak');
      replay.setAttribute('data-text', s.answer);
      replay.textContent = '🔊 Hear the phrase again';
      card.appendChild(replay);
    }
  } else if (typo) showFeedback('correct', 'Almost! Watch the spelling: ' + s.answer);
  else if (ok) showFeedback('correct', 'Correct! 🎉 (' + s.answer + ')');
  else showFeedback('wrong', 'Wrong — correct answer: ' + s.answer);
  if (ttsOn()) speak(s.word.es);
  revealContext(s);

  recordAnswer(s, ok);
}

function handleKnow() {
  var s = session.steps[session.idx];
  if (!s) return;
  session.skipped[s.rank] = 1;
  session.results[s.rank] = { ok: 1, bad: 0 };
  applySrs(s.rank);
  session.idx += 1;
  renderStep();
}

function nextStep() {
  session.idx += 1;
  renderStep();
}

function finishSession() {
  if (session.finished) return;
  session.finished = true;
  session.active = false;

  var completionBonus = session.mode === 'situation' && !session.rewardEligible ? 0 : XP_SESSION;
  var gained = session.xp + completionBonus;
  if (session.mode === 'new') state.lastNewDay = todayStr();
  addXP(gained);
  saveState();

  hide($('#session-active'));
  hide($('#btn-end-session'));
  show($('#session-summary'));

  if (session.mode === 'situation') {
    setText('#summary-title', 'You kept the conversation going. 🎉');
    var unassisted = Object.keys(session.results).filter(function (rank) {
      return session.results[rank].bad === 0 && !session.hints[rank];
    }).length;
    var practiceMessage = unassisted + ' of ' + session.baseTotal + ' replies came to you without a hint. Missed phrases returned before you finished; hinted phrases are due for review again today.';
    if (!session.rewardEligible) practiceMessage += ' This early practice kept the phrases fresh without moving their review dates.';
    setText('#summary-message', practiceMessage);
    setText('#summary-correct', fmt(unassisted));
    setText('#summary-wrong', fmt(session.baseTotal - unassisted));
    setText('#summary-correct-label', 'without hint');
    setText('#summary-wrong-label', 'needed help');
  } else {
    setText('#summary-title', 'All done! 🎉');
    setText('#summary-message', 'A little practice today makes tomorrow’s recall easier.');
    setText('#summary-correct', fmt(session.correct));
    setText('#summary-wrong', fmt(session.wrong));
    setText('#summary-correct-label', 'correct');
    setText('#summary-wrong-label', 'wrong');
  }
  setText('#summary-xp', '+' + fmt(gained));

  renderHome();
}

function quitSession() {
  if (session.active && !session.finished) {
    addXP(session.xp);              // without the completion bonus
    saveState();
  }
  session.active = false;
  hide($('#session-active'));
  hide($('#btn-end-session'));
  hide($('#session-summary'));
  renderLearnStart();
  renderHome();
}

function renderLearnStart() {
  if (session.active) {
    hide($('#session-start'));
    hide($('#session-summary'));
    show($('#session-active'));
    show($('#btn-end-session'));
    return;
  }
  hide($('#session-active'));
  hide($('#session-summary'));
  hide($('#btn-end-session'));
  show($('#session-start'));

  var due = dueCards().length;
  var newAvail = newWordList(10000).length;
  var dueShown = Math.min(due, REVIEW_LIMIT);
  var newShown = Math.min(state.settings.newPerSession || 10, newAvail);

  setText('#review-desc', '(' + fmt(dueShown) + ')');
  setText('#new-desc', '(' + fmt(newShown) + ')');

  var hint = $('#learn-hint');
  if (hint) {
    if (!due && !newAvail) hint.textContent = 'Done — you have learned every word! 🎉';
    else if (!newAvail) hint.textContent = 'You already know every word, just keep reviewing. 👍';
    else hint.textContent = 'Tip: review first, then learn new words.';
  }

  $$('.btn-session').forEach(function (b) {
    b.disabled = (b.dataset.mode === 'review') ? (due === 0) : (newAvail === 0);
  });
  renderSituationList();
}
/* ============================================================
   GRAMMAR
   ============================================================ */
function mdHtml(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function tableHtml(rows) {
  if (!rows || !rows.length) return '';
  var html = '<table>';
  rows.forEach(function (row, ri) {
    html += '<tr>';
    row.forEach(function (cell) {
      html += ri === 0
        ? '<th>' + esc(cell) + '</th>'
        : '<td>' + esc(cell) + '</td>';
    });
    html += '</tr>';
  });
  return html + '</table>';
}

function exerciseHtml(ex, index) {
  var html = '<div class="exercise" data-ex="' + index + '">' +
    '<div class="exercise-q">' + esc(ex.q) + '</div>';

  if (ex.type === 'choice') {
    html += '<div class="ex-options">';
    ex.options.forEach(function (o, i) {
      html += '<button type="button" class="ex-opt" data-act="ex-choice" data-i="' + i + '">' + esc(o) + '</button>';
    });
    html += '</div>';
  } else if (ex.type === 'fill') {
    html += '<input type="text" class="ex-input" autocomplete="off" autocorrect="off" ' +
      'autocapitalize="off" spellcheck="false" placeholder="type your answer" aria-label="Answer">' +
      '<div class="ex-actions"><button type="button" class="btn btn-primary" data-act="ex-check">Check</button></div>';
  } else if (ex.type === 'order') {
    html += '<div class="chip-row">';
    shuffle(ex.words).forEach(function (w) {
      html += '<button type="button" class="chip" data-act="ex-chip" data-w="' + esc(w) + '">' + esc(w) + '</button>';
    });
    html += '</div><div class="chip-line"></div>' +
      '<div class="ex-actions"><button type="button" class="btn btn-primary" data-act="ex-check">Check</button></div>';
  }

  return html + '<div class="ex-fb"></div></div>';
}

function findLesson(id) {
  for (var i = 0; i < grammar.length; i++) if (grammar[i].id === id) return grammar[i];
  return null;
}

var GRAMMAR_CORE_IDS = {
  'articles-gender': true, 'plural-nouns': true, 'ser-estar': true,
  'present-regular': true, 'irregular-essentials': true, 'hay-estar': true,
  'ir-a-futuro': true, 'reflexive-verbs': true, 'gustar': true,
  'por-para': true, 'negation-questions': true, 'preterito-perfecto': true
};
var grammarView = 'core';

function renderGrammar() {
  var acc = $('#grammar-accordion');
  if (!acc) return;

  var search = $('#grammar-search');
  var q = normalize(search ? search.value : '');
  var visible = grammar.filter(function (lesson) {
    return grammarView === 'more' ? !GRAMMAR_CORE_IDS[lesson.id] : !!GRAMMAR_CORE_IDS[lesson.id];
  });
  var doneCount = visible.filter(function (lesson) { return !!state.grammarDone[lesson.id]; }).length;
  setText('#grammar-progress', doneCount + ' / ' + visible.length + ' complete');
  setText('#grammar-level-hint', grammarView === 'core'
    ? 'Work through these essentials in order. Each lesson has a short explanation and practice.'
    : 'These topics build on the foundations and are useful as you move toward B1.');
  $$('.grammar-level-btn').forEach(function (button) {
    var active = button.getAttribute('data-level') === grammarView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  acc.innerHTML = '';
  visible.forEach(function (lesson) {
    if (q && normalize(lesson.title).indexOf(q) === -1 && normalize(lesson.text).indexOf(q) === -1) return;

    var done = !!(state.grammarDone && state.grammarDone[lesson.id]);
    var lessonLevel = GRAMMAR_CORE_IDS[lesson.id] ? 'A1–A2' : 'A2–B1';
    var body = '<p>' + mdHtml(lesson.text) + '</p>';
    if (lesson.table) body += tableHtml(lesson.table);
    if (lesson.exercises) {
      lesson.exercises.forEach(function (ex, ei) { body += exerciseHtml(ex, ei); });
    }
    body += '<div class="ex-actions"><button type="button" class="btn btn-ghost" data-act="lesson-done"' +
      (done ? ' disabled' : '') + '>' +
      (done ? '✅ Lesson complete' : '✔ Complete after practice (+15 XP)') + '</button></div>';

    var item = document.createElement('div');
    item.className = 'acc-item';
    item.dataset.id = lesson.id;
    item.innerHTML =
      '<div class="acc-head">' +
        '<button type="button" class="acc-check" data-act="lesson-done" aria-label="Mark lesson as done"' +
          (done ? ' disabled' : '') + '>' +
          (done ? '✅' : '⬜') + '</button>' +
        '<button type="button" class="acc-toggle" data-act="toggle">' +
          '<span class="acc-title">' + esc(lesson.title) + '</span>' +
          '<span class="lesson-level">' + lessonLevel + '</span>' +
          '<span class="acc-caret">▾</span>' +
        '</button>' +
      '</div>' +
      '<div class="acc-body">' + body + '</div>';
    acc.appendChild(item);
  });
}

function openLesson(id) {
  grammarView = GRAMMAR_CORE_IDS[id] ? 'core' : 'more';
  var search = $('#grammar-search');
  if (search) search.value = '';
  showTab('grammar');
  var item = $('.acc-item[data-id="' + id + '"]');
  if (item) { item.classList.add('open'); item.scrollIntoView({ block: 'start' }); }
}

function exFeedback(box, ok, why) {
  var fb = $('.ex-fb', box);
  if (!fb) return;
  fb.className = 'ex-fb show ' + (ok ? 'correct' : 'wrong');
  fb.textContent = (ok ? '✔ Correct! ' : '✘ Wrong. ') + (why || '');
}

function toggleLessonDone(item) {
  var id = item.dataset.id;
  if (!state.grammarDone) state.grammarDone = {};
  if (state.grammarDone[id]) return;
  var untried = $$('.exercise', item).some(function (exercise) {
    return !$('.ex-fb', exercise) || !$('.ex-fb', exercise).classList.contains('show');
  });
  if (untried) { toast('Try each exercise before completing the lesson.'); return; }
  state.grammarDone[id] = todayStr();
  addDailyProgress(1);
  addXP(15);
  toast('Lesson complete! +15 XP 🎉');
  saveState();
  renderGrammar();
  renderHome();
}

function handleExChoice(item, box, index) {
  var lesson = findLesson(item.dataset.id);
  if (!lesson) return;
  var ex = lesson.exercises[Number(box.dataset.ex)];
  if (!ex) return;

  var ok = normalize(ex.options[index]) === normalize(ex.answer);
  $$('.ex-opt', box).forEach(function (o, i) {
    o.disabled = true;
    if (normalize(ex.options[i]) === normalize(ex.answer)) o.classList.add('correct');
    if (i === index && !ok) o.classList.add('wrong');
  });
  exFeedback(box, ok, ex.why);
}

function handleExCheck(item, box) {
  var lesson = findLesson(item.dataset.id);
  if (!lesson) return;
  var ex = lesson.exercises[Number(box.dataset.ex)];
  if (!ex) return;

  var ok = false;
  var correct = ex.answer || '';

  if (ex.type === 'order') {
    var line = $('.chip-line', box);
    if (!line) return;
    var user = $$('.chip', line).map(function (c) { return c.dataset.w; }).join(' ');
    correct = ex.answer || (ex.words || []).join(' ');
    ok = normalize(user) === normalize(correct);
    $$('.chip', line).forEach(function (c) {
      c.classList.remove('correct', 'wrong');
      c.classList.add(ok ? 'correct' : 'wrong');
    });
  } else {
    var input = $('.ex-input', box);
    if (!input) return;
    ok = normalize(input.value) === normalize(correct);
    input.classList.remove('correct', 'wrong');
    input.classList.add(ok ? 'correct' : 'wrong');
  }

  var why = ex.why || '';
  if (!ok) why = (why ? why + ' · ' : '') + 'correct: ' + correct;
  exFeedback(box, ok, why);
}

function moveChip(chip) {
  var box = chip.closest('.exercise');
  if (!box) return;
  var pool = $('.chip-row', box);
  var line = $('.chip-line', box);
  if (!pool || !line) return;
  if (chip.parentNode === pool) line.appendChild(chip);
  else pool.appendChild(chip);
}
/* ============================================================
   VERBS
   ============================================================ */
var PERSONS = ['yo', 'tú', 'él/ella/usted', 'nosotros', 'vosotros', 'ellos/ustedes'];

function findVerb(inf) {
  for (var i = 0; i < verbs.length; i++) if (verbs[i].inf === inf) return verbs[i];
  return null;
}

function conjTableHtml(conj, title) {
  if (!conj) return '';
  var html = '<h3>' + esc(title) + '</h3><table class="conj-table"><tbody>';
  PERSONS.forEach(function (p) {
    html += '<tr><td>' + esc(p) + '</td><td>' + esc(conj[p] || '—') + '</td></tr>';
  });
  return html + '</tbody></table>';
}

function renderVerbs() {
  var list = $('#verbs-list');
  if (!list) return;
  var search = $('#verbs-search');
  var q = normalize(search ? search.value : '');
  list.innerHTML = '';
  var shown = 0;

  verbs.forEach(function (v) {
    if (q && normalize(v.inf).indexOf(q) === -1 &&
        normalize(v.en).indexOf(q) === -1) return;
    shown += 1;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'verb-item';
    b.setAttribute('data-inf', v.inf);
    b.setAttribute('data-act', 'verb-open');
    b.innerHTML =
      '<span class="verb-main">' +
        '<span class="verb-inf">' + esc(v.inf) + '</span>' +
        '<span class="verb-tr">' + esc(v.en || '') + '</span>' +
      '</span>' +
      '<span class="verb-tag">' + esc(v.type || '') + '</span>';
    list.appendChild(b);
  });

  if (!shown) {
    var p = document.createElement('p');
    p.className = 'hint';
    p.textContent = verbs.length ? 'Nothing found.' : 'Could not load the verbs.';
    list.appendChild(p);
  }
}

function openVerbDetail(inf) {
  var v = findVerb(inf);
  if (!v) return;

  var html = '<div class="modal-head">' +
      '<h2>' + esc(v.inf) + '</h2>' +
      '<button type="button" class="modal-close" data-act="modal-close" aria-label="Close">✕</button>' +
    '</div>' +
    '<p class="hint">' + esc(v.en || '') +
      (v.type ? ' · ' + esc(v.type) : '') + '</p>' +
    '<div class="conj-block">' +
      conjTableHtml(v.presente, 'Present') +
      conjTableHtml(v.pretérito, 'Preterite') +
      '<h3>Futuro (ir a + infinitiv)</h3><p>' + esc(v.futuro_ir_a || '—') + '</p>' +
      '<h3>Participio</h3><p>' + esc(v.participio || '—') + '</p>' +
    '</div>';

  if (v.example) {
    html += '<div class="card-example"><div class="es">' + esc(v.example.es) + '</div>' +
      '<div class="en">' + esc(v.example.en) + '</div></div>';
  }

  html += '<div class="ex-actions">' +
      '<button type="button" class="btn btn-primary" data-act="drill-from" data-inf="' + esc(v.inf) + '">🎲 Practise forms</button>' +
    '</div>';

  openModal(html);
}

var drill = null;

function startDrill(inf) {
  if (!verbs.length) { toast('Verbs are not available right now.'); return; }
  var v = inf ? findVerb(inf) : pick(verbs);
  if (!v) return;

  var tenses = [];
  if (v.presente) tenses.push('presente');
  if (v.pretérito) tenses.push('pretérito');
  if (!tenses.length) return;

  for (var attempt = 0; attempt < 25; attempt++) {
    var tense = pick(tenses);
    var person = pick(PERSONS);
    var form = (v[tense] || {})[person];
    if (form) {
      drill = { verb: v, tense: tense, person: person, answer: form, rewarded: false };
      renderDrill();
      return;
    }
  }
}

function renderDrill() {
  if (!drill) return;
  var tenseLabel = drill.tense === 'presente' ? 'Present' : 'Preterite';
  var html = '<div class="modal-head">' +
      '<h2>🎲 Conjugation</h2>' +
      '<button type="button" class="modal-close" data-act="modal-close" aria-label="Close">✕</button>' +
    '</div>' +
    '<p class="hint">' + esc(drill.verb.en || '') + '</p>' +
    '<div class="drill-question">' + esc(drill.verb.inf) + ' · ' + esc(drill.person) +
      '<br><small>' + esc(tenseLabel) + '</small></div>' +
    '<input type="text" class="drill-input" id="drill-input" autocomplete="off" autocorrect="off" ' +
      'autocapitalize="off" spellcheck="false" placeholder="type the correct form" aria-label="Verb form">' +
    '<div class="ex-actions">' +
      '<button type="button" class="btn btn-primary" data-act="drill-check">Check</button>' +
      '<button type="button" class="btn btn-ghost" data-act="drill-next">Next</button>' +
    '</div>' +
    '<div class="ex-fb" id="drill-fb"></div>';
  openModal(html);
  var inp = $('#drill-input');
  if (inp) inp.focus();
}

function checkDrill() {
  var inp = $('#drill-input');
  if (!inp || !drill) return;
  var ok = normalize(inp.value) === normalize(drill.answer);
  inp.classList.remove('correct', 'wrong');
  inp.classList.add(ok ? 'correct' : 'wrong');

  var fb = $('#drill-fb');
  if (fb) {
    fb.className = 'ex-fb show ' + (ok ? 'correct' : 'wrong');
    fb.textContent = ok ? '✔ Correct!' : '✘ Wrong — correct answer: ' + drill.answer;
  }
  if (ok && !drill.rewarded) {
    drill.rewarded = true;
    inp.disabled = true;
    addDailyProgress(1);
    addXP(3);
    saveState();
    renderHome();
  }
}
/* ============================================================
   MORE — settings, word browser, backup
   ============================================================ */
var WORDS_PER_PAGE = 50;
var wordsShown = 0;

function renderMore() {
  var sel = $('#set-theme');
  if (sel) sel.value = state.settings.theme || 'auto';

  var tts = $('#set-tts');
  if (tts) {
    tts.checked = state.settings.tts !== false;
    tts.disabled = !ttsSupported;
    if (!ttsSupported) tts.closest('.setting-row').title = 'This browser does not support speech synthesis';
  }

  var goal = $('#set-goal');
  if (goal) goal.value = state.dailyGoal;

  var nw = $('#set-new');
  if (nw) nw.value = state.settings.newPerSession;

  renderWordList(true);
}

function renderWordList(reset) {
  var list = $('#word-list');
  if (!list) return;

  var search = $('#words-search');
  var filterSel = $('#words-filter');
  var q = normalize(search ? search.value : '');
  var filter = filterSel ? filterSel.value : 'all';

  var filtered = words.filter(function (w) {
    var learned = !!state.cards[w.rank];
    if (filter === 'learned' && !learned) return false;
    if (filter === 'new' && learned) return false;
    if (q && normalize(w.es).indexOf(q) === -1 && enKey(w.en).indexOf(q) === -1) return false;
    return true;
  });

  if (reset) { list.innerHTML = ''; wordsShown = 0; }

  var slice = filtered.slice(wordsShown, wordsShown + WORDS_PER_PAGE);
  slice.forEach(function (w) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'word-row';
    b.setAttribute('data-rank', String(w.rank));
    b.setAttribute('data-act', 'word-open');
    b.innerHTML =
      '<span class="w-es">' + esc(String(w.es).toLowerCase()) + '</span>' +
      '<span class="w-en">' + esc(w.en) + '</span>' +
      '<span class="w-rank">#' + w.rank + (state.cards[w.rank] ? ' ✅' : '') + '</span>';
    list.appendChild(b);
  });
  wordsShown += slice.length;

  setText('#words-count', 'Showing ' + fmt(wordsShown) + ' of ' + fmt(filtered.length) + ' words');

  var more = $('#btn-words-more');
  if (more) { if (wordsShown < filtered.length) show(more); else hide(more); }
}

function openWordCard(rank) {
  var w = findWordByRank(Number(rank));
  if (!w) return;

  var c = state.cards[w.rank];
  var status = c
    ? 'Learned · box ' + (c.box || 0) + ' · next review ' + c.due
    : 'Not learned yet';

  var html = '<div class="modal-head">' +
      '<h2>' + esc(String(w.es).toLowerCase()) + '</h2>' +
      '<button type="button" class="modal-close" data-act="modal-close" aria-label="Close">✕</button>' +
    '</div>' +
    '<p class="card-sub" style="text-align:left;margin-bottom:10px">' + esc(w.en) + '</p>' +
    '<div class="card-example">' +
      '<div class="es">' + exampleEsHtml(w, false) + '</div>' +
      '<div class="en">' + esc(w.ex_en || '') + '</div>' +
    '</div>' +
    '<p class="hint">#' + w.rank + ' · ' + esc(status) + '</p>';

  if (ttsOn()) {
    html += '<div class="ex-actions"><button type="button" class="btn btn-ghost" ' +
      'data-act="speak" data-text="' + esc(w.es) + '">🔊 Play</button></div>';
  }

  openModal(html);
}

function exportProgress() {
  try {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'spanish2000-progress-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('Progress exported ⬇');
  } catch (e) {
    toast('Export failed 😕');
  }
}

function importProgress(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var p = JSON.parse(String(reader.result));
      if (!p || typeof p !== 'object' || !p.cards) throw new Error('missing "cards"');

      state.cards = p.cards || {};
      state.situationCards = p.situationCards && typeof p.situationCards === 'object' ? p.situationCards : {};
      state.grammarDone = p.grammarDone || {};
      state.xp = Number(p.xp) || 0;
      state.streak = Number(p.streak) || 0;
      state.lastDay = typeof p.lastDay === 'string' ? p.lastDay : '';
      state.lastNewDay = typeof p.lastNewDay === 'string' ? p.lastNewDay : '';
      state.doneToday = Number(p.doneToday) || 0;
      state.dailyGoal = Number(p.dailyGoal) || state.dailyGoal;
      if (p.settings) {
        state.settings.tts = p.settings.tts !== false;
        state.settings.newPerSession = Number(p.settings.newPerSession) || state.settings.newPerSession;
        state.settings.theme = p.settings.theme || state.settings.theme;
      }
      saveState();
      applyTheme();
      renderMore();
      renderHome();
      toast('Progress loaded ⬆');
    } catch (e) {
      toast('Import failed: ' + e.message, 4000);
    }
  };
  reader.onerror = function () { toast('Could not read the file 😕'); };
  reader.readAsText(file);
}

function resetProgress() {
  if (!window.confirm('Delete all progress? This cannot be undone.')) return;
  var theme = state.settings.theme || 'auto';
  state = defaultState();
  state.settings.theme = theme;
  saveState();
  applyTheme();
  renderMore();
  renderHome();
  renderLearnStart();
  toast('Progress deleted 🗑');
}
/* ============================================================
   OVLÁDÁNÍ, START A TESTY
   ============================================================ */
var storageEnabled = true;

function onDocumentClick(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (!el) return;
  var act = el.getAttribute('data-act');

  if (act === 'modal-close') { closeModal(); return; }
  if (act === 'situation-start') { startSession('situation', el.getAttribute('data-id')); return; }
  if (act === 'plan') { runPlanStep(el.getAttribute('data-step')); return; }
  if (act === 'show-hint') {
    var hint = $('#conversation-hint');
    if (hint) show(hint);
    var current = session.steps[session.idx];
    if (current) session.hints[current.rank] = true;
    el.disabled = true;
    return;
  }
  if (act === 'speak') {
    if (!ttsSupported) { toast('This browser does not support speech synthesis.'); return; }
    if (!ttsOn()) { toast('Pronunciation is turned off in Settings.'); return; }
    if (!speak(el.getAttribute('data-text'))) toast('Could not play the pronunciation.');
    return;
  }
  if (act === 'verb-open') { openVerbDetail(el.getAttribute('data-inf')); return; }
  if (act === 'word-open') { openWordCard(el.getAttribute('data-rank')); return; }
  if (act === 'drill-from') { startDrill(el.getAttribute('data-inf')); return; }
  if (act === 'drill-check') { checkDrill(); return; }
  if (act === 'drill-next') { startDrill(drill ? drill.verb.inf : null); return; }

  if (act === 'toggle') {
    var it = el.closest('.acc-item');
    if (it) it.classList.toggle('open');
    return;
  }

  var item = el.closest('.acc-item');
  var box = el.closest('.exercise');

  if (act === 'lesson-done') { if (item) toggleLessonDone(item); return; }
  if (act === 'ex-choice') {
    if (item && box) handleExChoice(item, box, Number(el.getAttribute('data-i')));
    return;
  }
  if (act === 'ex-check') { if (item && box) handleExCheck(item, box); return; }
  if (act === 'ex-chip') { moveChip(el); return; }

  if (act === 'know') { handleKnow(); return; }
  if (act === 'continue') { nextStep(); return; }
  if (act === 'submit') { handleWriteSubmit(); return; }
  if (act === 'mic') { startMic(el); return; }
  if (act === 'option') { handleOptionClick(Number(el.getAttribute('data-index'))); return; }
}

function onKeydown(e) {
  var tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();

  if (e.key === 'Escape') {
    var modal = $('#modal');
    if (modal && !modal.hasAttribute('hidden')) { closeModal(); return; }
  }

  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (e.key === 'Enter') {
      var id = e.target.id;
      if (id === 'session-input') {
        e.preventDefault();
        var current = session.steps[session.idx];
        if (current && current.done) {
          var next = $('#btn-next');
          if (next && !next.hasAttribute('hidden')) next.click();
        } else handleWriteSubmit();
      }
      else if (id === 'drill-input') { e.preventDefault(); checkDrill(); }
      else if (e.target.classList && e.target.classList.contains('ex-input')) {
        e.preventDefault();
        var box = e.target.closest('.exercise');
        var item = e.target.closest('.acc-item');
        if (box && item) handleExCheck(item, box);
      }
    }
    return;
  }

  if (e.key >= '1' && e.key <= '4') {
    var opts = $$('#answer-area .option-btn');
    if (opts.length) {
      var o = opts[Number(e.key) - 1];
      if (o && !o.disabled) { e.preventDefault(); o.click(); }
      return;
    }
  }

  if (e.key === 'Enter') {
    var next = $('#btn-next');
    if (next && !next.hasAttribute('hidden')) { e.preventDefault(); next.click(); }
  }
}
function wire() {
  var navs = [
    ['#btn-home', 'home'], ['#btn-learn', 'learn'], ['#btn-grammar', 'grammar'],
    ['#btn-verbs', 'verbs'], ['#btn-more', 'more']
  ];
  navs.forEach(function (pair) {
    var b = $(pair[0]);
    if (b) b.addEventListener('click', function () { showTab(pair[1]); });
  });

  $$('.theme-btn').forEach(function (b) { b.addEventListener('click', toggleTheme); });

  listen('#btn-review', 'click', function () { showTab('learn'); startSession('review'); });
  listen('#btn-new', 'click', function () { showTab('learn'); startSession('new'); });
  listen('#btn-plan-next', 'click', function () {
    var next = planSteps.filter(function (p) { return !p.done; })[0];
    runPlanStep(next ? next.id : null);
  });

  $$('.btn-session').forEach(function (b) {
    b.addEventListener('click', function () { startSession(b.getAttribute('data-mode')); });
  });

  listen('#btn-end-session', 'click', quitSession);
  listen('#btn-next', 'click', nextStep);
  listen('#btn-summary-home', 'click', function () { showTab('home'); });
  listen('#btn-summary-again', 'click', function () {
    if (session.mode === 'situation') startSession('situation', session.situationId);
    else startSession(session.mode === 'review' ? 'review' : 'new');
  });

  listen('#grammar-search', 'input', renderGrammar);
  $$('.grammar-level-btn').forEach(function (button) {
    button.addEventListener('click', function () {
      grammarView = this.getAttribute('data-level') === 'more' ? 'more' : 'core';
      renderGrammar();
    });
  });
  listen('#verbs-search', 'input', renderVerbs);
  listen('#words-search', 'input', function () { renderWordList(true); });
  listen('#words-filter', 'change', function () { renderWordList(true); });
  listen('#btn-words-more', 'click', function () { renderWordList(false); });
  listen('#btn-verb-drill', 'click', function () { startDrill(); });

  listen('#set-theme', 'change', function () { setTheme(this.value); });
  listen('#set-tts', 'change', function () { state.settings.tts = this.checked; saveState(); });
  listen('#set-goal', 'change', function () {
    state.dailyGoal = Math.min(200, Math.max(5, Number(this.value) || 20));
    this.value = state.dailyGoal;
    saveState(); renderHome();
  });
  listen('#set-new', 'change', function () {
    state.settings.newPerSession = Math.min(30, Math.max(5, Number(this.value) || 10));
    this.value = state.settings.newPerSession;
    saveState(); renderHome(); renderLearnStart();
  });

  listen('#btn-export', 'click', exportProgress);
  listen('#btn-import', 'click', function () { var f = $('#import-file'); if (f) f.click(); });
  listen('#import-file', 'change', function () {
    if (this.files && this.files[0]) importProgress(this.files[0]);
    this.value = '';
  });
  listen('#btn-reset', 'click', resetProgress);

  var modal = $('#modal');
  if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { if ((state.settings.theme || 'auto') === 'auto') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
}

function listen(sel, evt, fn) {
  var el = $(sel);
  if (el) el.addEventListener(evt, fn);
}
/* ---------------- Tests (run with ?test=1) ---------------- */
function runTests() {
  var results = [];
  function t(name, cond) { results.push({ name: name, ok: !!cond }); }

  t('normalize("estás") === normalize("estas")', normalize('estás') === normalize('estas'));
  t('normalize("HOLA") === "hola"', normalize('HOLA') === 'hola');
  t('normalize("  hola  ") === "hola"', normalize('  hola  ') === 'hola');
  t('enKey("The (Feminine)") === "the"', enKey('The (Feminine)') === 'the');
  t('addDays("2024-01-15", 1) === "2024-01-16"', addDays('2024-01-15', 1) === '2024-01-16');
  t('addDays("2024-01-15", 3) === "2024-01-18"', addDays('2024-01-15', 3) === '2024-01-18');
  t('isTypo: one wrong letter in "gracias" accepted', isTypo('grasias', 'gracias'));
  t('isTypo: short words must be exact', !isTypo('la', 'lo') && !isTypo('mas', 'mes'));
  t('isTypo: two errors in a short word rejected', !isTypo('grasia', 'gracias'));
  var fixed = repairExample({ ex_es: 'Mi problema es lo lejos que', ex_en: 'queda. My problem is how far it is.' });
  t('repairExample moves the split tail back', fixed.ex_es === 'Mi problema es lo lejos que queda.' && fixed.ex_en === 'My problem is how far it is.');
  t('repairExample leaves good examples alone', repairExample({ ex_es: 'Hola.', ex_en: 'Hi.' }).ex_es === 'Hola.');

  storageEnabled = false;                 // tests must not overwrite the saved state
  var backup = state;

  state = defaultState();
  state.cards[1] = { box: 0, due: todayStr(), seen: 0, ok: 0 };
  answerCorrect(1);
  t('Leitner: correct on box 0 → box 1', state.cards[1].box === 1);
  t('Leitner: correct → due = today + 1', state.cards[1].due === addDays(todayStr(), 1));

  state.cards[2] = { box: 3, due: todayStr(), seen: 0, ok: 0 };
  answerWrong(2);
  t('Leitner: wrong on box 3 → box 0', state.cards[2].box === 0);
  t('Leitner: wrong → due = today', state.cards[2].due === todayStr());

  state.cards[3] = { box: MAX_BOX, due: todayStr(), seen: 0, ok: 0 };
  answerCorrect(3);
  t('Leitner: top box stays at ' + MAX_BOX + ', due in 180 days', state.cards[3].box === MAX_BOX && state.cards[3].due === addDays(todayStr(), 180));

  var m = mergeProgress({ grammarDone: { a: true, b: '2026-01-02' }, lastNewDay: '2026-01-01' },
    { grammarDone: { a: '2026-01-03' }, lastNewDay: '2026-01-05' });
  t('merge keeps grammar completion dates and newest lastNewDay',
    m.grammarDone.a === '2026-01-03' && m.grammarDone.b === '2026-01-02' && m.lastNewDay === '2026-01-05');

  state = defaultState();
  state.streak = 5;
  state.lastDay = addDays(todayStr(), -1);
  touchStreak();
  t('Streak: lastDay = yesterday → +1', state.streak === 6);

  state.streak = 5;
  state.lastDay = addDays(todayStr(), -2);
  touchStreak();
  t('Streak: lastDay = two days ago → 1', state.streak === 1);

  state = backup;
  storageEnabled = true;

  t('words.json: length > 1900', words.length > 1900);
  t('words.json: every entry has es, en, ex_es, ex_en',
    words.every(function (w) { return !!(w.es && w.en && w.ex_es && w.ex_en); }));

  var okCount = results.filter(function (r) { return r.ok; }).length;
  if (window.console) {
    if (console.group) console.group('Spanish 2000 — testy');
    results.forEach(function (r) {
      if (r.ok) console.log('✔ ' + r.name);
      else console.error('✘ ' + r.name);
    });
    if (console.groupEnd) console.groupEnd();
    console.log('Testy: ' + okCount + '/' + results.length + ' OK');
  }
  window.__testResults = results;
  toast('Testy: ' + okCount + '/' + results.length + ' OK', 6000);
  return results;
}

/* Hides everything that carries the [hidden] attribute in the HTML. This guards
   against a stale cached CSS without [hidden]{display:none!important}, where our
   .btn/.modal display rules would make hidden elements visible. */
function applyHiddenStyles() {
  $$('[hidden]').forEach(function (el) { el.style.display = 'none'; });
}

/* ---------------- Start aplikace ---------------- */
function init() {
  loadState();
  applyHiddenStyles();
  applyTheme();
  wire();

  // window.appReady is awaited by sync.js so it does not sync before data is loaded
  window.appReady = loadData().then(function () {
    if (!words.length) toast('Could not load the vocabulary 😕', 6000);
    renderHome();
    renderLearnStart();
    if (location.search.indexOf('test=1') !== -1) runTests();
  });
  return window.appReady;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* ============================================================
   SLOUČENÍ POKROKU (pro cloudovou synchronizaci)
   Rule: never overwrite blindly — neither device may lose progress.
   ============================================================ */
function mergeProgress(local, remote) {
  var L = local || defaultState();
  var R = remote || defaultState();
  var out = defaultState();

  // cards: for each rank keep the record that is "more practised"
  var ranks = {};
  Object.keys(L.cards || {}).forEach(function (r) { ranks[r] = 1; });
  Object.keys(R.cards || {}).forEach(function (r) { ranks[r] = 1; });
  Object.keys(ranks).forEach(function (r) {
    var a = (L.cards || {})[r];
    var b = (R.cards || {})[r];
    if (a && !b) { out.cards[r] = a; return; }
    if (b && !a) { out.cards[r] = b; return; }
    var as = Number(a.seen) || 0, bs = Number(b.seen) || 0;
    if (as !== bs) { out.cards[r] = as > bs ? a : b; return; }
    out.cards[r] = (Number(a.box) || 0) >= (Number(b.box) || 0) ? a : b;
  });

  // Situation phrase reviews: preserve the more practised copy per phrase.
  var phraseKeys = {};
  Object.keys(L.situationCards || {}).forEach(function (k) { phraseKeys[k] = 1; });
  Object.keys(R.situationCards || {}).forEach(function (k) { phraseKeys[k] = 1; });
  Object.keys(phraseKeys).forEach(function (k) {
    var a = (L.situationCards || {})[k], b = (R.situationCards || {})[k];
    if (a && !b) { out.situationCards[k] = a; return; }
    if (b && !a) { out.situationCards[k] = b; return; }
    var as = Number(a.seen) || 0, bs = Number(b.seen) || 0;
    if (as !== bs) { out.situationCards[k] = as > bs ? a : b; return; }
    out.situationCards[k] = (Number(a.box) || 0) >= (Number(b.box) || 0) ? a : b;
  });

  // grammarDone: union, keeping the completion date when either side has one
  [L.grammarDone || {}, R.grammarDone || {}].forEach(function (g) {
    Object.keys(g).forEach(function (k) {
      if (typeof out.grammarDone[k] !== 'string') out.grammarDone[k] = typeof g[k] === 'string' ? g[k] : true;
    });
  });
  out.lastNewDay = (L.lastNewDay || '') > (R.lastNewDay || '') ? L.lastNewDay : (R.lastNewDay || '');

  // xp: maximum (a sum would double-count the same session)
  out.xp = Math.max(Number(L.xp) || 0, Number(R.xp) || 0);

  // daily streak: use the record with the newer lastDay
  var lDay = L.lastDay || '', rDay = R.lastDay || '';
  var winner = rDay > lDay ? R : L;
  out.lastDay = winner.lastDay || '';
  out.streak = Number(winner.streak) || 0;
  out.doneToday = (lDay && lDay === rDay)
    ? Math.max(Number(L.doneToday) || 0, Number(R.doneToday) || 0)
    : (Number(winner.doneToday) || 0);

  // settings: the local device wins
  out.settings = {
    tts: !(L.settings && L.settings.tts === false),
    newPerSession: Number(L.settings && L.settings.newPerSession) || 10,
    theme: (L.settings && L.settings.theme) || 'auto'
  };

  out.dailyGoal = Number(L.dailyGoal) || Number(R.dailyGoal) || 20;
  out.updatedAt = Math.max(Number(L.updatedAt) || 0, Number(R.updatedAt) || 0);
  return out;
}

function renderAll() {
  applyTheme();
  renderHome();
  if (!session.active) renderLearnStart();   // must not interrupt a running session
  renderGrammar();
  renderVerbs();
  renderMore();
}

// Applies cloud state (merged with local) without needless push cycles.
function applyRemoteState(remote) {
  var merged = mergeProgress(state, remote);
  state = merged;
  saveState(true);          // silent → do not push straight back
  renderAll();
  return merged;
}

// Console access for debugging
window.app = {
  state: function () { return state; },
  words: function () { return words; },
  grammar: function () { return grammar; },
  verbs: function () { return verbs; },
  situations: function () { return situations; },
  session: function () { return session; },
  runTests: runTests
};

// Bridge for sync.js (cloud sync)
window.S2000 = {
  onLocalSave: null,                       // set by sync.js
  getState: function () { return state; },
  snapshot: function () { return JSON.parse(JSON.stringify(state)); },
  merge: mergeProgress,
  applyRemote: applyRemoteState,
  setState: function (obj) { state = obj; saveState(true); renderAll(); },
  renderAll: renderAll,
  isSessionActive: function () { return !!session.active; },
  toast: toast,
  today: todayStr,
  fmt: fmt,
  storageDisabled: function () { return !storageEnabled; }
};












