/* ============================================================
   Spanish 2000 — veškerá logika aplikace (vanilla JS, bez build kroku)
   ============================================================ */
'use strict';

var STORAGE_KEY = 'es_state_v1';
var INTERVALS = [0, 1, 3, 7, 16, 35];   // dny podle boxu (Leitner)
var REVIEW_LIMIT = 30;                  // max karet na jedno opakování
var QUIZ_EVERY = 5;                     // mini-kvíz po každých 5 nových slovech
var XP_CORRECT = 10;
var XP_WRONG = 2;
var XP_SESSION = 20;

/* ---------------- Utility ---------------- */
function normalize(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Anglický význam bez poznámky o rodu: "The (Feminine)" -> "the"
function enKey(s) {
  return normalize(String(s == null ? '' : s).replace(/\([^)]*\)/g, ' '));
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// Lokální datum (ne UTC) ve tvaru YYYY-MM-DD
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
    xp: 0,
    streak: 0,
    lastDay: '',
    dailyGoal: 20,
    doneToday: 0,
    grammarDone: {},    // { lessonId: true }
    settings: { tts: true, newPerSession: 10, theme: 'auto' },
    updatedAt: 0        // ms timestamp poslední lokální změny (kvůli synchronizaci)
  };
}

var state = defaultState();
var words = [];
var grammar = [];
var verbs = [];

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var p = JSON.parse(raw);
    var s = defaultState();
    s.cards = p.cards && typeof p.cards === 'object' ? p.cards : {};
    s.grammarDone = p.grammarDone && typeof p.grammarDone === 'object' ? p.grammarDone : {};
    s.xp = Number(p.xp) || 0;
    s.streak = Number(p.streak) || 0;
    s.lastDay = typeof p.lastDay === 'string' ? p.lastDay : '';
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
    console.warn('Nepodařilo se načíst stav:', e);
  }
}

// silent = true → neupozorňovat cloudovou synchronizaci (používá se při
// zápisu dat stažených z cloudu, aby nevznikl nekonečný cyklus push/pull).
function saveState(silent) {
  if (!storageEnabled) return;
  if (!silent) state.updatedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Nepodařilo se uložit stav:', e); }
  if (!silent && window.S2000 && typeof window.S2000.onLocalSave === 'function') {
    window.S2000.onLocalSave();
  }
}
/* ---------------- Téma (světlý / tmavý režim) ---------------- */
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
    b.setAttribute('aria-label', r === 'dark' ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim');
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

/* ---------------- Streak, XP, úroveň ---------------- */
function touchStreak() {
  var today = todayStr();
  if (state.lastDay === today) return;              // dnes už proběhlo
  if (!state.lastDay) state.streak = 1;             // úplně první den
  else if (state.lastDay === addDays(today, -1)) state.streak += 1;
  else state.streak = 1;                            // pauza
  state.lastDay = today;
  state.doneToday = 0;
  saveState();
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

// Správně: box = min(box+1, 5), due = dnes + INTERVALS[box]
function answerCorrect(rank) {
  var c = ensureCard(rank);
  c.seen += 1;
  c.ok += 1;
  c.box = Math.min(c.box + 1, 5);
  c.due = addDays(todayStr(), INTERVALS[c.box]);
}

// Špatně: box = 0, due = dnes
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
  var d = [0, 0, 0, 0, 0, 0];
  Object.keys(state.cards).forEach(function (r) {
    var b = state.cards[r].box || 0;
    if (b >= 0 && b <= 5) d[b] += 1;
  });
  return d;
}

/* ---------------- TTS ---------------- */
var ttsSupported = ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window);
function ttsOn() { return ttsSupported && state.settings.tts !== false; }

function speak(text) {
  if (!ttsOn() || !text) return;
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'es-ES';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignoruj */ }
}

/* ---------------- Načtení dat ---------------- */
function fetchJson(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' pro ' + url);
    return r.json();
  });
}

function loadData() {
  return Promise.all([
    fetchJson('./words.json').then(function (d) { words = Array.isArray(d) ? d : []; })
      .catch(function (e) { console.error(e); words = []; }),
    fetchJson('./grammar.json').then(function (d) { grammar = Array.isArray(d) ? d : []; })
      .catch(function (e) { console.error(e); grammar = []; }),
    fetchJson('./verbs.json').then(function (d) { verbs = Array.isArray(d) ? d : []; })
      .catch(function (e) { console.error(e); verbs = []; })
  ]);
}
/* ---------------- DOM pomocníci ---------------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

// POZOR: vlastnost .hidden (a ani atribut [hidden]) nemusí stačit —
// naše CSS pravidla jako .modal{display:flex} nebo .btn{display:inline-flex}
// přebíjejí výchozí [hidden]{display:none} z prohlížeče. Proto nastavujeme
// i inline display, který je nejsilnější a funguje i se starou cache CSS.
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

/* ---------------- Přepínání záložek ---------------- */
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
  if (h < 10) return 'Dobré ráno';
  if (h < 18) return 'Dobrý den';
  return 'Dobrý večer';
}

/* ---------------- Domů ---------------- */
function renderHome() {
  // POZOR: touchStreak() se volá jen jednou při startu aplikace (v init()),
  // jinak by přepsal dnešní pokrok při každém vykreslení Domů.

  var g = $('#greeting');
  if (g) g.textContent = greetingText() + '! 👋';

  setText('#streak-value', fmt(state.streak));
  setText('#xp-value', fmt(state.xp) + ' XP');
  setText('#level-value', fmt(level()));
  setText('#goal-value', state.doneToday + ' / ' + state.dailyGoal);

  var lp = $('#level-fill');
  if (lp) lp.style.width = levelPercent() + '%';
  setText('#level-caption', 'Úroveň ' + level() + ' • do další ' + fmt(xpToNext()) + ' XP');

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
  setText('#coverage-percent', coveragePercent().toFixed(1).replace('.', ',') + ' %');

  // Rozložení podle boxů
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
  saveState();
}

function boxColor(i) {
  return ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#0ea5e9'][i] || 'var(--border)';
}

function setText(sel, text) {
  var el = $(sel);
  if (el) el.textContent = text;
}
/* ============================================================
   PROCVIČOVÁNÍ — fáze, kroky a SRS
   ============================================================ */

/* Rozdělení příkladové věty, abychom uměli zvýraznit / vynechat hledané slovo */
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

/* Distraktory z blízkého ranku (±30), jinak z celého seznamu */
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
  return { type: 'intro', rank: w.rank, label: 'Seznámení', word: w };
}

function stepChoiceEsEn(w, label) {
  return {
    type: 'choice', rank: w.rank, label: label, word: w,
    big: String(w.es).toLowerCase(), sub: 'Vyber správný význam',
    options: shuffle([w.en].concat(distractorList(w, 3, 'en'))),
    answer: w.en, keyFn: enKey
  };
}

function stepWriteEnEs(w, label) {
  return {
    type: 'write', rank: w.rank, label: label, word: w,
    big: w.en, sub: 'Napiš španělsky',
    answer: String(w.es).toLowerCase(), keyFn: normalize
  };
}

function stepFill(w, label) {
  if (!findWordInExample(w.ex_es || '', w.es).found) return null;
  return {
    type: 'choice', rank: w.rank, label: label, word: w, fill: true,
    sub: 'Doplň slovo do věty',
    options: shuffle([String(w.es).toLowerCase()].concat(distractorList(w, 3, 'es'))),
    answer: String(w.es).toLowerCase(), keyFn: normalize
  };
}

function stepListen(w, label) {
  if (!ttsOn()) return null;
  return {
    type: 'listen', rank: w.rank, label: label, word: w,
    sub: 'Poslouchej a vyber správný význam', speak: w.es,
    options: shuffle([w.en].concat(distractorList(w, 3, 'en'))),
    answer: w.en, keyFn: enKey
  };
}

function findWordByRank(rank) {
  for (var i = 0; i < words.length; i++) if (words[i].rank === rank) return words[i];
  return null;
}

var session = {
  active: false, mode: null, steps: [], baseTotal: 0, idx: 0,
  results: {}, skipped: {}, counted: {}, requeued: {},
  correct: 0, wrong: 0, xp: 0, finished: false
};

function buildNewSteps() {
  var list = newWordList(state.settings.newPerSession || 10);
  if (!list.length) return null;
  var steps = [];
  for (var i = 0; i < list.length; i += QUIZ_EVERY) {
    var chunk = list.slice(i, i + QUIZ_EVERY);
    chunk.forEach(function (w) { steps.push(stepIntro(w)); });
    chunk.forEach(function (w) { steps.push(stepChoiceEsEn(w, 'Mini-kvíz')); });
  }
  list.forEach(function (w) { steps.push(stepWriteEnEs(w, 'Závěrečné kolo')); });
  return steps;
}

function buildReviewSteps() {
  var due = dueCards().slice(0, REVIEW_LIMIT);
  if (!due.length) return null;
  var steps = [];
  due.forEach(function (c) {
    var w = findWordByRank(c.rank);
    if (!w) return;
    var modes = ['es-en', 'en-es'];
    if (findWordInExample(w.ex_es || '', w.es).found) modes.push('fill');
    if (ttsOn()) modes.push('listen');
    var mode = pick(modes), st = null;
    if (mode === 'es-en') st = stepChoiceEsEn(w, 'Opakování');
    else if (mode === 'en-es') st = stepWriteEnEs(w, 'Opakování');
    else if (mode === 'fill') st = stepFill(w, 'Opakování');
    else st = stepListen(w, 'Opakování');
    if (st) steps.push(st);
  });
  return steps;
}

function startSession(mode) {
  var steps = (mode === 'review') ? buildReviewSteps() : buildNewSteps();
  if (!steps || !steps.length) {
    toast(mode === 'review' ? 'Teď není co opakovat 🎉' : 'Všechna slovíčka už máš naučená 🎉');
    return;
  }
  session.active = true;
  session.finished = false;
  session.mode = mode;
  session.steps = steps;
  session.baseTotal = steps.length;
  session.idx = 0;
  session.results = {};
  session.skipped = {};
  session.counted = {};
  session.requeued = {};
  session.correct = 0;
  session.wrong = 0;
  session.xp = 0;

  hide($('#session-start'));
  hide($('#session-summary'));
  show($('#session-active'));
  show($('#btn-end-session'));
  renderStep();
}
/* ---------------- Vykreslení jednoho kroku ---------------- */
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
  setText('#session-progress-label', Math.min(done + 1, total) + ' / ' + total);
  setText('#phase-indicator', s.label || '');

  hide($('#feedback'));
  hide($('#btn-next'));

  var cardEl = $('#card-container');
  var ansEl = $('#answer-area');
  cardEl.innerHTML = cardHtml(s);
  ansEl.innerHTML = answerHtml(s);

  if (s.type === 'write') {
    var inp = $('#session-input');
    if (inp) inp.focus();
  }
  if (s.type === 'listen') speak(s.speak);
}

function cardHtml(s) {
  var w = s.word;

  if (s.type === 'intro') {
    var btn = ttsOn()
      ? ' <button type="button" class="speaker-btn" data-act="speak" data-text="' + esc(w.es) + '">🔊</button>'
      : '';
    return '<div class="card-word">' + esc(String(w.es).toLowerCase()) + '</div>' +
      '<div class="card-sub">' + esc(w.en) + '</div>' +
      '<div class="card-example">' +
        '<div class="es">' + exampleEsHtml(w, false) + btn + '</div>' +
        '<div class="en">' + esc(w.ex_en || '') + '</div>' +
      '</div>';
  }

  if (s.type === 'listen') {
    var replay = ttsOn()
      ? '<button type="button" class="btn btn-ghost" data-act="speak" data-text="' + esc(s.speak) + '">🔊 Přehrát znovu</button>'
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
    return '<button type="button" class="btn btn-primary btn-large" data-act="know">✔ Už to znám</button>' +
      '<button type="button" class="btn btn-ghost btn-large" data-act="continue">📖 Učit se</button>';
  }

  if (s.type === 'write') {
    return '<div class="input-group">' +
      '<input type="text" id="session-input" autocomplete="off" autocorrect="off" ' +
      'autocapitalize="off" spellcheck="false" placeholder="napiš španělsky" aria-label="Tvá odpověď">' +
      '<button type="button" class="btn btn-primary" data-act="submit">Odeslat</button>' +
      '</div>';
  }

  var html = '<div class="options-grid">';
  for (var i = 0; i < s.options.length; i++) {
    html += '<button type="button" class="option-btn" data-act="option" data-index="' + i + '">' +
      esc(s.options[i]) + '</button>';
  }
  return html + '</div>';
}
/* ---------------- Vyhodnocení odpovědi ---------------- */
function showFeedback(kind, text) {
  var el = $('#feedback');
  if (!el) return;
  el.className = 'feedback ' + kind;
  el.textContent = text;
  show(el);
}

function recordAnswer(s, ok) {
  var r = session.results[s.rank] || (session.results[s.rank] = { ok: 0, bad: 0 });
  if (ok) { r.ok += 1; session.correct += 1; session.xp += XP_CORRECT; }
  else { r.bad += 1; session.wrong += 1; session.xp += XP_WRONG; }

  if (!ok) requeueCard(s.rank);

  var remaining = false;
  for (var i = session.idx + 1; i < session.steps.length; i++) {
    if (session.steps[i].rank === s.rank) { remaining = true; break; }
  }
  if (!remaining) applySrs(s.rank);

  var last = (session.idx + 1 >= session.steps.length) && !remaining;
  setText('#btn-next', last ? 'Dokončit' : 'Další');
  show($('#btn-next'));
}

function requeueCard(rank) {
  if (session.requeued[rank]) return;
  var w = findWordByRank(rank);
  if (!w) return;
  session.requeued[rank] = 1;
  session.steps.push(stepChoiceEsEn(w, 'Znovu'));
}

function applySrs(rank) {
  var r = session.results[rank];
  if (!r) return;
  ensureCard(rank);
  if (r.ok > r.bad) answerCorrect(rank);
  else answerWrong(rank);
  if (!session.counted[rank]) {
    session.counted[rank] = 1;
    state.doneToday = (state.doneToday || 0) + 1;
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

  if (ok) showFeedback('correct', 'Správně! 🎉');
  else showFeedback('wrong', 'Špatně — správně: ' + s.answer);
  if (ttsOn()) speak(s.word.es);

  recordAnswer(s, ok);
}

function handleWriteSubmit() {
  var s = session.steps[session.idx];
  if (!s || s.done) return;
  var inp = $('#session-input');
  if (!inp) return;
  if (!normalize(inp.value)) { inp.focus(); return; }
  s.done = true;

  var ok = s.keyFn(inp.value) === s.keyFn(s.answer);
  inp.disabled = true;
  inp.classList.add(ok ? 'correct' : 'wrong');

  if (ok) showFeedback('correct', 'Správně! 🎉 (' + s.answer + ')');
  else showFeedback('wrong', 'Špatně — správně: ' + s.answer);
  if (ttsOn()) speak(s.word.es);

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

  var gained = session.xp + XP_SESSION;
  addXP(gained);
  saveState();

  hide($('#session-active'));
  hide($('#btn-end-session'));
  show($('#session-summary'));

  setText('#summary-correct', fmt(session.correct));
  setText('#summary-wrong', fmt(session.wrong));
  setText('#summary-xp', '+' + fmt(gained));

  renderHome();
}

function quitSession() {
  if (session.active && !session.finished) {
    addXP(session.xp);              // bez bonusu za dokončení
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
    if (!due && !newAvail) hint.textContent = 'Hotovo — všechna slovíčka máš naučená! 🎉';
    else if (!newAvail) hint.textContent = 'Všechna slovíčka už znáš, stačí opakovat. 👍';
    else hint.textContent = 'Tip: nejdřív opakuj, pak se uč nová slova.';
  }

  $$('.btn-session').forEach(function (b) {
    b.disabled = (b.dataset.mode === 'review') ? (due === 0) : (newAvail === 0);
  });
}
/* ============================================================
   GRAMATIKA
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
      'autocapitalize="off" spellcheck="false" placeholder="napiš odpověď" aria-label="Odpověď">' +
      '<div class="ex-actions"><button type="button" class="btn btn-primary" data-act="ex-check">Ověřit</button></div>';
  } else if (ex.type === 'order') {
    html += '<div class="chip-row">';
    shuffle(ex.words).forEach(function (w) {
      html += '<button type="button" class="chip" data-act="ex-chip" data-w="' + esc(w) + '">' + esc(w) + '</button>';
    });
    html += '</div><div class="chip-line"></div>' +
      '<div class="ex-actions"><button type="button" class="btn btn-primary" data-act="ex-check">Ověřit</button></div>';
  }

  return html + '<div class="ex-fb"></div></div>';
}

function findLesson(id) {
  for (var i = 0; i < grammar.length; i++) if (grammar[i].id === id) return grammar[i];
  return null;
}
function renderGrammar() {
  var acc = $('#grammar-accordion');
  if (!acc) return;

  var search = $('#grammar-search');
  var q = normalize(search ? search.value : '');
  var doneCount = 0;
  Object.keys(state.grammarDone || {}).forEach(function (k) { if (state.grammarDone[k]) doneCount += 1; });
  setText('#grammar-progress', doneCount + ' / ' + grammar.length + ' hotovo');

  acc.innerHTML = '';
  grammar.forEach(function (lesson) {
    if (q && normalize(lesson.title).indexOf(q) === -1 && normalize(lesson.text).indexOf(q) === -1) return;

    var done = !!(state.grammarDone && state.grammarDone[lesson.id]);
    var body = '<p>' + mdHtml(lesson.text) + '</p>';
    if (lesson.table) body += tableHtml(lesson.table);
    if (lesson.exercises) {
      lesson.exercises.forEach(function (ex, ei) { body += exerciseHtml(ex, ei); });
    }
    body += '<div class="ex-actions"><button type="button" class="btn btn-ghost" data-act="lesson-done">' +
      (done ? '↺ Označit jako nehotové' : '✔ Mám hotovo (+15 XP)') + '</button></div>';

    var item = document.createElement('div');
    item.className = 'acc-item';
    item.dataset.id = lesson.id;
    item.innerHTML =
      '<div class="acc-head">' +
        '<button type="button" class="acc-check" data-act="lesson-done" aria-label="Označit lekci jako hotovou">' +
          (done ? '✅' : '⬜') + '</button>' +
        '<button type="button" class="acc-toggle" data-act="toggle">' +
          '<span class="acc-title">' + esc(lesson.title) + '</span>' +
          '<span class="acc-caret">▾</span>' +
        '</button>' +
      '</div>' +
      '<div class="acc-body">' + body + '</div>';
    acc.appendChild(item);
  });
}

function exFeedback(box, ok, why) {
  var fb = $('.ex-fb', box);
  if (!fb) return;
  fb.className = 'ex-fb show ' + (ok ? 'correct' : 'wrong');
  fb.textContent = (ok ? '✔ Správně! ' : '✘ Špatně. ') + (why || '');
}

function toggleLessonDone(item) {
  var id = item.dataset.id;
  if (!state.grammarDone) state.grammarDone = {};
  if (state.grammarDone[id]) {
    delete state.grammarDone[id];
  } else {
    state.grammarDone[id] = true;
    addXP(15);
    toast('Lekce splněna! +15 XP 🎉');
  }
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
  if (!ok) why = (why ? why + ' · ' : '') + 'správně: ' + correct;
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
   SLOVESA
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
        normalize(v.en).indexOf(q) === -1 &&
        normalize(v.cz).indexOf(q) === -1) return;
    shown += 1;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'verb-item';
    b.setAttribute('data-inf', v.inf);
    b.setAttribute('data-act', 'verb-open');
    b.innerHTML =
      '<span class="verb-main">' +
        '<span class="verb-inf">' + esc(v.inf) + '</span>' +
        '<span class="verb-tr">' + esc((v.en || '') + (v.cz ? ' · ' + v.cz : '')) + '</span>' +
      '</span>' +
      '<span class="verb-tag">' + esc(v.type || '') + '</span>';
    list.appendChild(b);
  });

  if (!shown) {
    var p = document.createElement('p');
    p.className = 'hint';
    p.textContent = verbs.length ? 'Nic nenalezeno.' : 'Slovesa se nepodařilo načíst.';
    list.appendChild(p);
  }
}

function openVerbDetail(inf) {
  var v = findVerb(inf);
  if (!v) return;

  var html = '<div class="modal-head">' +
      '<h2>' + esc(v.inf) + '</h2>' +
      '<button type="button" class="modal-close" data-act="modal-close" aria-label="Zavřít">✕</button>' +
    '</div>' +
    '<p class="hint">' + esc((v.en || '') + (v.cz ? ' · ' + v.cz : '')) +
      (v.type ? ' · ' + esc(v.type) : '') + '</p>' +
    '<div class="conj-block">' +
      conjTableHtml(v.presente, 'Presente') +
      conjTableHtml(v.pretérito, 'Pretérito') +
      '<h3>Futuro (ir a + infinitiv)</h3><p>' + esc(v.futuro_ir_a || '—') + '</p>' +
      '<h3>Participio</h3><p>' + esc(v.participio || '—') + '</p>' +
    '</div>';

  if (v.example) {
    html += '<div class="card-example"><div class="es">' + esc(v.example.es) + '</div>' +
      '<div class="en">' + esc(v.example.en) + '</div></div>';
  }

  html += '<div class="ex-actions">' +
      '<button type="button" class="btn btn-primary" data-act="drill-from" data-inf="' + esc(v.inf) + '">🎲 Procvičit tvary</button>' +
    '</div>';

  openModal(html);
}

var drill = null;

function startDrill(inf) {
  if (!verbs.length) { toast('Slovesa nejsou k dispozici 😕'); return; }
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
      drill = { verb: v, tense: tense, person: person, answer: form };
      renderDrill();
      return;
    }
  }
}

function renderDrill() {
  if (!drill) return;
  var tenseLabel = drill.tense === 'presente' ? 'Presente' : 'Pretérito';
  var html = '<div class="modal-head">' +
      '<h2>🎲 Časování</h2>' +
      '<button type="button" class="modal-close" data-act="modal-close" aria-label="Zavřít">✕</button>' +
    '</div>' +
    '<p class="hint">' + esc((drill.verb.en || '') + (drill.verb.cz ? ' · ' + drill.verb.cz : '')) + '</p>' +
    '<div class="drill-question">' + esc(drill.verb.inf) + ' · ' + esc(drill.person) +
      '<br><small>' + esc(tenseLabel) + '</small></div>' +
    '<input type="text" class="drill-input" id="drill-input" autocomplete="off" autocorrect="off" ' +
      'autocapitalize="off" spellcheck="false" placeholder="napiš správný tvar" aria-label="Tvar slovesa">' +
    '<div class="ex-actions">' +
      '<button type="button" class="btn btn-primary" data-act="drill-check">Ověřit</button>' +
      '<button type="button" class="btn btn-ghost" data-act="drill-next">Další</button>' +
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
    fb.textContent = ok ? '✔ Správně!' : '✘ Špatně — správně: ' + drill.answer;
  }
  if (ok) { addXP(3); saveState(); }
}
/* ============================================================
   VÍC — nastavení, procházení slovíček, záloha
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
    if (!ttsSupported) tts.closest('.setting-row').title = 'Prohlížeč nepodporuje hlasovou syntézu';
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

  setText('#words-count', 'Zobrazeno ' + fmt(wordsShown) + ' z ' + fmt(filtered.length) + ' slov');

  var more = $('#btn-words-more');
  if (more) { if (wordsShown < filtered.length) show(more); else hide(more); }
}

function openWordCard(rank) {
  var w = findWordByRank(Number(rank));
  if (!w) return;

  var c = state.cards[w.rank];
  var status = c
    ? 'Naučeno · box ' + (c.box || 0) + ' · další opakování ' + c.due
    : 'Zatím nenaučeno';

  var html = '<div class="modal-head">' +
      '<h2>' + esc(String(w.es).toLowerCase()) + '</h2>' +
      '<button type="button" class="modal-close" data-act="modal-close" aria-label="Zavřít">✕</button>' +
    '</div>' +
    '<p class="card-sub" style="text-align:left;margin-bottom:10px">' + esc(w.en) + '</p>' +
    '<div class="card-example">' +
      '<div class="es">' + exampleEsHtml(w, false) + '</div>' +
      '<div class="en">' + esc(w.ex_en || '') + '</div>' +
    '</div>' +
    '<p class="hint">#' + w.rank + ' · ' + esc(status) + '</p>';

  if (ttsOn()) {
    html += '<div class="ex-actions"><button type="button" class="btn btn-ghost" ' +
      'data-act="speak" data-text="' + esc(w.es) + '">🔊 Přehrát</button></div>';
  }

  openModal(html);
}

function exportProgress() {
  try {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'spanish2000-pokrok-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('Pokrok exportován ⬇');
  } catch (e) {
    toast('Export se nepovedl 😕');
  }
}

function importProgress(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var p = JSON.parse(String(reader.result));
      if (!p || typeof p !== 'object' || !p.cards) throw new Error('chybí "cards"');

      state.cards = p.cards || {};
      state.grammarDone = p.grammarDone || {};
      state.xp = Number(p.xp) || 0;
      state.streak = Number(p.streak) || 0;
      state.lastDay = typeof p.lastDay === 'string' ? p.lastDay : '';
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
      toast('Pokrok načten ⬆');
    } catch (e) {
      toast('Import se nepovedl: ' + e.message, 4000);
    }
  };
  reader.onerror = function () { toast('Soubor se nepodařilo přečíst 😕'); };
  reader.readAsText(file);
}

function resetProgress() {
  if (!window.confirm('Opravdu smazat veškerý pokrok? Tuto akci nelze vrátit.')) return;
  var theme = state.settings.theme || 'auto';
  state = defaultState();
  state.settings.theme = theme;
  saveState();
  applyTheme();
  renderMore();
  renderHome();
  renderLearnStart();
  toast('Pokrok smazán 🗑');
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
  if (act === 'speak') { speak(el.getAttribute('data-text')); return; }
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
      if (id === 'session-input') { e.preventDefault(); handleWriteSubmit(); }
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

  $$('.btn-session').forEach(function (b) {
    b.addEventListener('click', function () { startSession(b.getAttribute('data-mode')); });
  });

  listen('#btn-end-session', 'click', quitSession);
  listen('#btn-next', 'click', nextStep);
  listen('#btn-summary-home', 'click', function () { showTab('home'); });
  listen('#btn-summary-again', 'click', function () {
    startSession(session.mode === 'review' ? 'review' : 'new');
  });

  listen('#grammar-search', 'input', renderGrammar);
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
/* ---------------- Testy (spusť s ?test=1) ---------------- */
function runTests() {
  var results = [];
  function t(name, cond) { results.push({ name: name, ok: !!cond }); }

  t('normalize("estás") === normalize("estas")', normalize('estás') === normalize('estas'));
  t('normalize("HOLA") === "hola"', normalize('HOLA') === 'hola');
  t('normalize("  hola  ") === "hola"', normalize('  hola  ') === 'hola');
  t('enKey("The (Feminine)") === "the"', enKey('The (Feminine)') === 'the');
  t('addDays("2024-01-15", 1) === "2024-01-16"', addDays('2024-01-15', 1) === '2024-01-16');
  t('addDays("2024-01-15", 3) === "2024-01-18"', addDays('2024-01-15', 3) === '2024-01-18');

  storageEnabled = false;                 // testy nesmí přepsat uložený stav
  var backup = state;

  state = defaultState();
  state.cards[1] = { box: 0, due: todayStr(), seen: 0, ok: 0 };
  answerCorrect(1);
  t('Leitner: správně na boxu 0 → box 1', state.cards[1].box === 1);
  t('Leitner: správně → due = dnes + 1', state.cards[1].due === addDays(todayStr(), 1));

  state.cards[2] = { box: 3, due: todayStr(), seen: 0, ok: 0 };
  answerWrong(2);
  t('Leitner: špatně na boxu 3 → box 0', state.cards[2].box === 0);
  t('Leitner: špatně → due = dnes', state.cards[2].due === todayStr());

  state = defaultState();
  state.streak = 5;
  state.lastDay = addDays(todayStr(), -1);
  touchStreak();
  t('Streak: lastDay = včera → +1', state.streak === 6);

  state.streak = 5;
  state.lastDay = addDays(todayStr(), -2);
  touchStreak();
  t('Streak: lastDay = předevčírem → 1', state.streak === 1);

  state = backup;
  storageEnabled = true;

  t('words.json: délka > 1900', words.length > 1900);
  t('words.json: každý záznam má es, en, ex_es, ex_en',
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

/* Skryje vše, co má v HTML atribut [hidden]. Chráníme se tím proti tomu,
   kdyby v prohlížeči zůstalo v cache staré CSS bez [hidden]{display:none!important}
   a naše .btn/.modal display pravidla by skryté prvky zobrazila. */
function applyHiddenStyles() {
  $$('[hidden]').forEach(function (el) { el.style.display = 'none'; });
}

/* ---------------- Start aplikace ---------------- */
function init() {
  loadState();
  touchStreak();          // jednou za den: streak + reset denního pokroku
  applyHiddenStyles();
  applyTheme();
  wire();

  // window.appReady čeká sync.js, aby nesynchronizoval dřív, než jsou data načtená
  window.appReady = loadData().then(function () {
    if (!words.length) toast('Slovíček se nepodařilo načíst 😕', 6000);
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
   Pravidlo: nikdy nepřepisovat naslepo — o pokrok nesmí přijít
   ani jedno zařízení.
   ============================================================ */
function mergeProgress(local, remote) {
  var L = local || defaultState();
  var R = remote || defaultState();
  var out = defaultState();

  // cards: u každého ranku ponech záznam, který je „více procvičený“
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

  // grammarDone: sjednocení
  Object.keys(L.grammarDone || {}).forEach(function (k) { out.grammarDone[k] = true; });
  Object.keys(R.grammarDone || {}).forEach(function (k) { out.grammarDone[k] = true; });

  // xp: maximum (součet by dvojitě počítal stejné session)
  out.xp = Math.max(Number(L.xp) || 0, Number(R.xp) || 0);

  // denní série: použij záznam s novějším lastDay
  var lDay = L.lastDay || '', rDay = R.lastDay || '';
  var winner = rDay > lDay ? R : L;
  out.lastDay = winner.lastDay || '';
  out.streak = Number(winner.streak) || 0;
  out.doneToday = (lDay && lDay === rDay)
    ? Math.max(Number(L.doneToday) || 0, Number(R.doneToday) || 0)
    : (Number(winner.doneToday) || 0);

  // nastavení: vyhrává lokální zařízení
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
  if (!session.active) renderLearnStart();   // nesmí přerušit běžící session
  renderGrammar();
  renderVerbs();
  renderMore();
}

// Aplikuje stav z cloudu (sloučený s lokálním) bez zbytečných push cyklů.
function applyRemoteState(remote) {
  var merged = mergeProgress(state, remote);
  state = merged;
  saveState(true);          // silent → neodesílat hned zpět
  renderAll();
  return merged;
}

// Přístup z konzole pro ladění
window.app = {
  state: function () { return state; },
  words: function () { return words; },
  grammar: function () { return grammar; },
  verbs: function () { return verbs; },
  session: function () { return session; },
  runTests: runTests
};

// Most pro sync.js (cloudová synchronizace)
window.S2000 = {
  onLocalSave: null,                       // nastaví sync.js
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












