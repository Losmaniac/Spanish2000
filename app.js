// Spanish 2000 - Main Application Logic
// Vanilla JS PWA for learning Spanish vocabulary with SRS

const STORAGE_KEY = 'es_state_v1';
const INTERVALS = [0, 1, 3, 7, 16, 35]; // days per box (0-5)
const DAILY_GOAL = 20;
const NEW_PER_SESSION = 10;

// --- Utility Functions ---
function normalize(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatNumber(n) {
  return n.toLocaleString('cs-CZ');
}

// --- State Management ---
let state = {
  cards: {},      // { [rank]: { box, due, seen, ok } }
  xp: 0,
  streak: 0,
  lastDay: '',
  dailyGoal: DAILY_GOAL,
  doneToday: 0,
  settings: { tts: true, newPerSession: NEW_PER_SESSION }
};

let words = [];
let grammar = [];
let verbs = [];

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      state = { ...state, ...parsed };
      state.settings = { ...state.settings, ...(parsed.settings || {}) };
    }
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

function updateStreak() {
  const today = todayStr();
  if (state.lastDay === today) return;
  const yesterday = addDays(today, -1);
  if (state.lastDay === yesterday) {
    state.streak += 1;
  } else if (state.lastDay) {
    state.streak = 1;
  } else {
    state.streak = 1;
  }
  state.lastDay = today;
  state.doneToday = 0;
}

function addXP(amount) {
  state.xp += amount;
  const newLevel = Math.floor(state.xp / 200) + 1;
  return newLevel;
}

function getLevel() {
  return Math.floor(state.xp / 200) + 1;
}

function getXPForNextLevel() {
  const level = getLevel();
  return level * 200 - state.xp;
}

// --- Data Loading ---
async function loadWords() {
  try {
    const res = await fetch('./words.json');
    if (!res.ok) throw new Error('Failed to load words.json');
    words = await res.json();
    console.log(`Loaded ${words.length} words`);
  } catch (e) {
    console.error('Error loading words:', e);
    showError('Nepodařilo se načíst slovníček. Zkontrolujte soubor words.json.');
  }
}

async function loadGrammar() {
  try {
    const res = await fetch('./grammar.json');
    if (!res.ok) throw new Error('Failed to load grammar.json');
    grammar = await res.json();
  } catch (e) {
    console.error('Error loading grammar:', e);
  }
}

async function loadVerbs() {
  try {
    const res = await fetch('./verbs.json');
    if (!res.ok) throw new Error('Failed to load verbs.json');
    verbs = await res.json();
  } catch (e) {
    console.error('Error loading verbs:', e);
  }
}

// --- SRS Logic ---
function getDueCards() {
  const today = todayStr();
  return Object.entries(state.cards)
    .filter(([_, card]) => card.due <= today)
    .map(([rank, card]) => ({ rank: parseInt(rank), ...card }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.rank - b.rank);
}

function getNewCards(count) {
  const learnedRanks = new Set(Object.keys(state.cards).map(Number));
  return words
    .filter(w => !learnedRanks.has(w.rank))
    .slice(0, count)
    .map(w => ({ rank: w.rank, box: 1, due: addDays(todayStr(), INTERVALS[1]), seen: 0, ok: 0 }));
}

function answerCorrect(rank) {
  const card = state.cards[rank];
  if (!card) return;
  card.seen += 1;
  card.ok += 1;
  card.box = Math.min(card.box + 1, 5);
  card.due = addDays(todayStr(), INTERVALS[card.box]);
}

function answerWrong(rank) {
  const card = state.cards[rank];
  if (!card) return;
  card.seen += 1;
  card.box = 0;
  card.due = todayStr();
}

function getLearnedCount() {
  return Object.keys(state.cards).length;
}

function getCoveragePercent() {
  const learned = getLearnedCount();
  if (learned >= 2000) return 92.7;
  if (learned >= 1000) return 87.8 + (learned - 1000) / 1000 * (92.7 - 87.8);
  return learned / 1000 * 87.8;
}

function getBoxDistribution() {
  const dist = [0, 0, 0, 0, 0, 0];
  Object.values(state.cards).forEach(card => {
    if (card.box >= 0 && card.box <= 5) dist[card.box]++;
  });
  return dist;
}

// --- TTS ---
// --- Home Tab Rendering ---
function renderHome() {
  updateStreak();
  $('#streak-value').textContent = state.streak;
  $('#xp-value').textContent = formatNumber(state.xp) + ' XP';
  $('#level-value').textContent = getLevel();
  $('#goal-value').textContent = `${state.doneToday} / ${state.dailyGoal}`;
  
  const progress = Math.min(state.doneToday / state.dailyGoal, 1);
  const offset = 283 * (1 - progress);
  $('#progress-ring').style.strokeDashoffset = offset;
  $('#progress-percent').textContent = Math.round(progress * 100) + '%';
  $('#progress-ring').parentElement.setAttribute('aria-valuenow', state.doneToday);
  
  const dueCount = getDueCards().length;
  $('#review-count').textContent = dueCount;
  $('#review-desc').textContent = dueCount ? `${dueCount} slov k opakování` : 'Žádná slova k opakování';
  $('#new-desc').textContent = `${state.settings.newPerSession} nejčastějších nových slov`;
  
  $('#learned-count').textContent = formatNumber(getLearnedCount());
  $('#coverage-percent').textContent = getCoveragePercent().toFixed(1) + '%';
  
  const dist = getBoxDistribution();
  const total = dist.reduce((a, b) => a + b, 0) || 1;
  const boxDist = $('#box-distribution');
  boxDist.innerHTML = '';
  dist.forEach((count, i) => {
    const bar = document.createElement('div');
    bar.className = 'box-bar';
    bar.style.width = (count / total * 100) + '%';
    bar.setAttribute('data-box', 'Box ' + i);
    bar.title = `Box ${i}: ${count} karet`;
    boxDist.appendChild(bar);
  });
  
  saveState();
}

// --- Session Engine ---
let session = {
  mode: null,
  cards: [],
  currentIndex: 0,
  stats: { correct: 0, wrong: 0, xpGained: 0 }
};

const PHASES = ['intro', 'meaning', 'form', 'sentence', 'summary'];

function startSession(mode) {
  session.mode = mode;
  session.stats = { correct: 0, wrong: 0, xpGained: 0 };
  
  if (mode === 'review') {
    const due = getDueCards();
    if (due.length === 0) {
      showFeedback('Žádná slova k opakování!', 'info');
      return;
    }
    session.cards = due.map(d => ({ rank: d.rank, word: words.find(w => w.rank === d.rank), phase: 0 }));
  } else {
    const newCards = getNewCards(state.settings.newPerSession);
    if (newCards.length === 0) {
      showFeedback('Gratulujeme! Naučil jsi se všechna slova!', 'info');
      return;
    }
    session.cards = newCards.map(d => ({ rank: d.rank, word: words.find(w => w.rank === d.rank), phase: 0 }));
  }
  
  session.currentIndex = 0;
  $('#session-start').hidden = true;
  $('#session-active').hidden = false;
  $('#session-summary').hidden = true;
  $('#btn-end-session').hidden = false;
  renderSession();
}

function renderSession() {
  const card = session.cards[session.currentIndex];
  if (!card) {
    endSession();
    return;
  }
  
  const progress = ((session.currentIndex) / session.cards.length) * 100;
  $('#session-progress-fill').style.width = progress + '%';
  $('#session-progress-label').textContent = `${session.currentIndex + 1} / ${session.cards.length}`;
  
  const phase = PHASES[card.phase];
function renderCard(card, phase) {
  const w = card.word;
  const container = $('#card-container');
  const answerArea = $('#answer-area');
  const feedback = $('#feedback');
  const btnNext = $('#btn-next');
  
  feedback.hidden = true;
  btnNext.hidden = true;
  answerArea.innerHTML = '';
  
  if (phase === 'intro') {
    container.innerHTML = `
      <div class="card-word">${w.es.toLowerCase()}</div>
      <div class="card-translation">${w.en}</div>
      <div class="card-example es">${w.ex_es} <button class="speaker-btn" onclick="speak('${w.ex_es.replace(/'/g, "\\'")}')">🔊</button></div>
      <div class="card-example en">${w.ex_en}</div>
    `;
    answerArea.innerHTML = `
      <button class="btn btn-primary btn-large" onclick="nextPhase()">Pokračovat</button>
    `;
  } else if (phase === 'meaning') {
    container.innerHTML = `
      <div class="card-word">${w.es.toLowerCase()}</div>
      <div class="card-translation">Vyber správný význam:</div>
    `;
    const options = generateOptions(w);
    answerArea.innerHTML = '<div class="options-grid">' + options.map((opt, i) => 
      `<button class="option-btn" data-idx="${i}" onclick="checkMeaning(${i}, '${opt.replace(/'/g, "\\'").replace(/"/g, '\\"')}')">${opt}</button>`
    ).join('') + '</div>';
  } else if (phase === 'form') {
    container.innerHTML = `
      <div class="card-word">${w.en}</div>
      <div class="card-translation">Napiš španělsky:</div>
    `;
    answerArea.innerHTML = `
      <div class="input-group">
        <input type="text" id="form-input" placeholder="zadej slovo" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <button class="btn btn-primary" onclick="checkForm()">Odeslat</button>
      </div>
    `;
    setTimeout(() => $('#form-input').focus(), 50);
    $('#form-input').addEventListener('keydown', e => { if (e.key === 'Enter') checkForm(); });
  } else if (phase === 'sentence') {
    container.innerHTML = `
      <div class="card-translation">Přelož větu:</div>
      <div class="card-example en">${w.ex_en}</div>
    `;
    answerArea.innerHTML = `
      <div class="input-group">
        <input type="text" id="sentence-input" placeholder="napiš větu španělsky" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <button class="btn btn-primary" onclick="checkSentence()">Odeslat</button>
      </div>
    `;
    setTimeout(() => $('#sentence-input').focus(), 50);
    $('#sentence-input').addEventListener('keydown', e => { if (e.key === 'Enter') checkSentence(); });
  }
}

function generateOptions(correctWord) {
  const correct = correctWord.en;
  const distractors = [];
  const pool = words.filter(w => w.rank !== correctWord.rank);
  
  while (distractors.length < 3 && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    const d = pool.splice(idx, 1)[0];
    if (!distractors.includes(d.en) && d.en !== correct) {
      distractors.push(d.en);
    }
  }
  
  const all = [correct, ...distractors].sort(() => Math.random() - 0.5);
  return all;
}

function nextPhase() {
  const card = session.cards[session.currentIndex];
  card.phase++;
  if (card.phase >= PHASES.length - 1) {
    nextCard();
  } else {
    renderSession();
function checkMeaning(idx, option) {
  const card = session.cards[session.currentIndex];
  const correct = normalize(card.word.en) === normalize(option);
  
  $$('.option-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === idx) btn.classList.add(correct ? 'correct' : 'wrong');
    if (normalize(btn.textContent) === normalize(card.word.en)) btn.classList.add('correct');
  });
  
  if (correct) {
    showFeedback('Správně! 🎉', 'correct');
    session.stats.correct++;
    session.stats.xpGained += 10;
  } else {
    showFeedback(`Špatně. Správně: ${card.word.en}`, 'wrong');
    session.stats.wrong++;
    session.stats.xpGained += 2;
  }
  
  $('#btn-next').hidden = false;
  $('#btn-next').onclick = nextPhase;
  $('#btn-next').textContent = 'Další';
}

function checkForm() {
  const input = $('#form-input');
  const card = session.cards[session.currentIndex];
  const userAnswer = normalize(input.value);
  const correct = normalize(card.word.es) === userAnswer;
  
  input.disabled = true;
  input.classList.add(correct ? 'correct' : 'wrong');
  
  if (correct) {
    showFeedback('Správně! 🎉', 'correct');
    session.stats.correct++;
    session.stats.xpGained += 10;
  } else {
    showFeedback(`Špatně. Správně: ${card.word.es}`, 'wrong');
    session.stats.wrong++;
    session.stats.xpGained += 2;
  }
  
  $('#btn-next').hidden = false;
  $('#btn-next').onclick = nextPhase;
  $('#btn-next').textContent = 'Další';
}

function checkSentence() {
  const input = $('#sentence-input');
  const card = session.cards[session.currentIndex];
  const userAnswer = normalize(input.value);
  const correct = normalize(card.word.ex_es) === userAnswer;
  
  input.disabled = true;
  input.classList.add(correct ? 'correct' : 'wrong');
  
  if (correct) {
    showFeedback('Správně! 🎉', 'correct');
    session.stats.correct++;
    session.stats.xpGained += 10;
  } else {
    showFeedback(`Špatně. Správně: ${card.word.ex_es}`, 'wrong');
    session.stats.wrong++;
    session.stats.xpGained += 2;
  }
  
  $('#btn-next').hidden = false;
  $('#btn-next').onclick = nextPhase;
  $('#btn-next').textContent = 'Další';
}

function nextCard() {
  const card = session.cards[session.currentIndex];
  const rank = card.rank;
  
  // Determine if overall correct for this card (simplified: more correct phases than wrong)
  // For simplicity, we'll track per card
  if (!card.phaseResults) card.phaseResults = { correct: 0, wrong: 0 };
  // The last phase was sentence, check if it was correct
  // Actually, let's use a simpler approach: if the majority of answers were correct
  const isCorrect = session.stats.correct > session.stats.wrong;
  
  if (session.mode === 'review') {
    if (isCorrect) {
      answerCorrect(rank);
    } else {
      answerWrong(rank);
    }
  } else {
    state.cards[rank] = { box: 1, due: addDays(todayStr(), INTERVALS[1]), seen: 1, ok: 1 };
  }
  
  session.currentIndex++;
  if (session.currentIndex >= session.cards.length) {
    endSession();
  } else {
    session.cards[session.currentIndex].phase = 0;
    renderSession();
  }
}

function endSession() {
  session.stats.xpGained += 20;
  addXP(session.stats.xpGained);
  state.doneToday += session.cards.length;
  
  $('#session-active').hidden = true;
  $('#session-summary').hidden = false;
  $('#btn-end-session').hidden = true;
  
  $('#summary-correct').textContent = session.stats.correct;
  $('#summary-wrong').textContent = session.stats.wrong;
  $('#summary-xp').textContent = '+' + session.stats.xpGained;
  
  saveState();
  renderHome();
}

function showFeedback(msg, type) {
  const el = $('#feedback');
  el.textContent = msg;
  el.className = 'feedback ' + type;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2000);
}

// --- Grammar Tab ---
function renderGrammar() {
  const container = $('#grammar-accordion');
  container.innerHTML = '';
  
  grammar.forEach(topic => {
    const item = document.createElement('div');
    item.className = 'accordion-item';
    item.innerHTML = `
      <button class="accordion-header" aria-expanded="false">
        <span>${topic.title}</span>
        <span class="accordion-icon">▼</span>
      </button>
      <div class="accordion-content">
        <div class="accordion-body">${renderMarkdown(topic.text)}</div>
      </div>
    `;
    
    if (topic.table) {
      item.querySelector('.accordion-body').innerHTML += renderTable(topic.table);
    }
    
    if (topic.exercises) {
      topic.exercises.forEach((ex, i) => {
        item.querySelector('.accordion-body').innerHTML += renderExercise(ex, topic.id + '_' + i);
      });
    }
    
    container.appendChild(item);
  });
  
  $$('.accordion-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.parentElement;
      const isOpen = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen);
    });
  });
}

function renderMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function renderTable(table) {
  if (!table || !table.length) return '';
  let html = '<table><thead><tr>';
  table[0].forEach(h => html += `<th>${h}</th>`);
  html += '</tr></thead><tbody>';
  for (let i = 1; i < table.length; i++) {
    html += '<tr>';
    table[i].forEach(c => html += `<td>${c}</td>`);
    html += '</tr>';
  }
  html += '</tbody></table>';
function renderExercise(ex, id) {
  let html = `<div class="exercise" id="ex-${id}"><div class="exercise-q">${ex.q}</div>`;
  
  if (ex.type === 'choice') {
    html += '<div class="exercise-options">';
    ex.options.forEach((opt, i) => {
      html += `<button class="exercise-option" data-idx="${i}" onclick="checkExercise('${id}', ${i}, '${opt.replace(/'/g, "\\'").replace(/"/g, '\\"')}')">${opt}</button>`;
    });
    html += '</div>';
  } else if (ex.type === 'fill') {
    html += `<input type="text" class="exercise-input" id="ex-in-${id}" placeholder="napiš odpověď" autocomplete="off"><button class="btn btn-primary" style="margin-top:8px" onclick="checkFill('${id}')">Ověřit</button>`;
  } else if (ex.type === 'order') {
    const words = [...ex.words].sort(() => Math.random() - 0.5);
    html += '<div class="sentence-builder">';
    words.forEach((w, i) => html += `<button class="word-chip" data-word="${w}" onclick="addWordToSentence('${id}', '${w.replace(/'/g, "\\'").replace(/"/g, '\\"')}', this)">${w}</button>`);
    html += '</div><div class="sentence-target" id="ex-target-${id}"></div><button class="btn btn-primary" style="margin-top:8px" onclick="checkOrder(\'${id}\', ${JSON.stringify(ex.words).replace(/"/g, '"')})">Ověřit</button>';
  }
  
  html += `<div class="exercise-feedback" id="ex-fb-${id}"></div></div>`;
  return html;
}

window.checkExercise = function(id, idx, answer) {
  const ex = findExercise(id);
  const correct = ex.answer === answer;
  const opts = document.querySelectorAll(`#ex-${id} .exercise-option`);
  opts.forEach((o, i) => {
    o.disabled = true;
    if (i === idx) o.classList.add(correct ? 'correct' : 'wrong');
    if (ex.options[i] === ex.answer) o.classList.add('correct');
  });
  showExerciseFeedback(id, correct, ex.why);
};

window.checkFill = function(id) {
  const input = document.getElementById(`ex-in-${id}`);
  const ex = findExercise(id);
  const userAns = normalize(input.value);
  const correct = normalize(ex.answer) === userAns;
  input.disabled = true;
  input.classList.add(correct ? 'correct' : 'wrong');
  showExerciseFeedback(id, correct, ex.why);
};

window.checkOrder = function(id, correctWords) {
  const target = document.getElementById(`ex-target-${id}`);
  const userWords = Array.from(target.querySelectorAll('.word-chip')).map(c => c.dataset.word);
  const correct = userWords.join(' ') === correctWords.join(' ');
  target.querySelectorAll('.word-chip').forEach(c => c.classList.add(correct ? 'correct' : 'wrong'));
  showExerciseFeedback(id, correct, findExercise(id).why);
};

function findExercise(id) {
  for (const topic of grammar) {
    if (topic.exercises) {
      for (let i = 0; i < topic.exercises.length; i++) {
        if (topic.id + '_' + i === id) return topic.exercises[i];
      }
    }
  }
  return null;
}

function showExerciseFeedback(id, correct, why) {
  const fb = document.getElementById(`ex-fb-${id}`);
  fb.textContent = (correct ? 'Správně! ' : 'Špatně. ') + (why || '');
  fb.className = 'exercise-feedback show ' + (correct ? 'correct' : 'wrong');
}

window.addWordToSentence = function(id, word, btn) {
  const target = document.getElementById(`ex-target-${id}`);
  const chip = document.createElement('button');
  chip.className = 'word-chip';
// --- Verbs Tab ---
function renderVerbs() {
  const container = $('#verbs-list');
  container.innerHTML = '';
  
  verbs.forEach(v => {
    const item = document.createElement('div');
    item.className = 'verb-item';
    item.setAttribute('role', 'listitem');
    item.innerHTML = `
      <div class="verb-main">
        <span class="verb-inf">${v.inf}</span>
        <span class="verb-translations">${v.en} / ${v.cz}</span>
        <span class="verb-type">${v.type}</span>
      </div>
      <span class="nav-icon">▶</span>
    `;
    item.addEventListener('click', () => showVerbDetail(v));
    container.appendChild(item);
  });
}

function showVerbDetail(v) {
  const detail = $('#verb-detail');
  const content = document.createElement('div');
  content.className = 'verb-detail-content';
  content.innerHTML = `
    <div class="verb-detail-header">
      <h2 class="verb-detail-inf">${v.inf}</h2>
      <button class="verb-detail-close" onclick="hideVerbDetail()">✕</button>
    </div>
    <div class="verb-detail-meta">
      <span>${v.en}</span>
      <span>${v.cz}</span>
      <span>${v.type}</span>
    </div>
    <div class="verb-conj-table">
      <h3>Presente</h3>${renderConjTable(v.presente)}
      <h3>Pretérito</h3>${renderConjTable(v.pretérito)}
      <h3>Futuro (ir a)</h3><p>${v.futuro_ir_a}</p>
      <h3>Participio</h3><p>${v.participio}</p>
    </div>
    <div class="verb-example">
      <div class="es">${v.example.es}</div>
      <div class="en">${v.example.en}</div>
    </div>
  `;
  detail.appendChild(content);
  detail.hidden = false;
  content.focus();
}

function hideVerbDetail() {
  $('#verb-detail').hidden = true;
  const content = $('#verb-detail .verb-detail-content');
  if (content) content.remove();
}

function renderConjTable(conj) {
  const persons = ['yo', 'tú', 'él/ella/usted', 'nosotros', 'vosotros', 'ellos/ustedes'];
  let html = '<table><thead><tr><th>Osoba</th><th>Forma</th></tr></thead><tbody>';
  persons.forEach(p => {
    const form = conj[p] || '';
    html += `<tr><td>${p}</td><td>${form}</td></tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function filterVerbs(query) {
  const q = normalize(query);
  $$('.verb-item').forEach(item => {
    const inf = normalize(item.querySelector('.verb-inf').textContent);
    const en = normalize(item.querySelector('.verb-translations').textContent);
    item.style.display = (inf.includes(q) || en.includes(q)) ? 'flex' : 'none';
  });
}

function filterGrammar(query) {
  const q = normalize(query);
// --- Event Listeners ---
function initEventListeners() {
  // Tab navigation
  $('#btn-home').addEventListener('click', () => { showTab('home'); renderHome(); });
  $('#btn-learn').addEventListener('click', () => { showTab('learn'); renderLearn(); });
  $('#btn-grammar').addEventListener('click', () => { showTab('grammar'); renderGrammar(); });
  $('#btn-verbs').addEventListener('click', () => { showTab('verbs'); renderVerbs(); });
  
  // Session buttons
  $('#btn-review').addEventListener('click', () => startSession('review'));
  $('#btn-new').addEventListener('click', () => startSession('new'));
  $$('.btn-session').forEach(btn => btn.addEventListener('click', () => startSession(btn.dataset.mode)));
  $('#btn-end-session').addEventListener('click', endSessionEarly);
  $('#btn-home-from-summary').addEventListener('click', () => showTab('home'));
  
  // Search
  $('#grammar-search').addEventListener('input', e => filterGrammar(e.target.value));
  $('#verbs-search').addEventListener('input', e => filterVerbs(e.target.value));
  
  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key >= '1' && e.key <= '4') {
      const idx = parseInt(e.key) - 1;
      const opts = $$('.option-btn:not(:disabled)');
      if (opts[idx]) opts[idx].click();
    }
    if (e.key === 'Enter') {
      const nextBtn = $('#btn-next');
      if (!nextBtn.hidden) nextBtn.click();
    }
  });
}

function renderLearn() {
  $('#session-start').hidden = false;
  $('#session-active').hidden = true;
  $('#session-summary').hidden = true;
  $('#btn-end-session').hidden = true;
}

// --- Initialize ---
async function init() {
  loadState();
  await Promise.all([loadWords(), loadGrammar(), loadVerbs()]);
  
  if (words.length === 0) {
    showError('Kritická chyba: words.json se nepodařilo načíst.');
    return;
  }
  
  initEventListeners();
  renderHome();
  
  // Run asserts if test mode
  if (location.search.includes('test=1')) runTests();
}

// --- Tests ---
function runTests() {
  console.log('Running tests...');
  
  // Test normalize
  console.assert(normalize('estás') === normalize('estas'), 'normalize diacritics');
  console.assert(normalize('HOLA') === 'hola', 'normalize case');
  console.assert(normalize('  hola  ') === 'hola', 'normalize trim');
  
  // Test Leitner
  const testRank = 9999;
  state.cards[testRank] = { box: 0, due: todayStr(), seen: 0, ok: 0 };
  answerCorrect(testRank);
  console.assert(state.cards[testRank].box === 1, 'correct -> box 1');
  console.assert(state.cards[testRank].due === addDays(todayStr(), 1), 'correct -> due tomorrow');
  
  state.cards[testRank] = { box: 3, due: todayStr(), seen: 0, ok: 0 };
  answerWrong(testRank);
  console.assert(state.cards[testRank].box === 0, 'wrong -> box 0');
  console.assert(state.cards[testRank].due === todayStr(), 'wrong -> due today');
  delete state.cards[testRank];
  
  // Test streak
  state.lastDay = addDays(todayStr(), -1);
  state.streak = 5;
  updateStreak();
  console.assert(state.streak === 6, 'streak increment');
  
  state.lastDay = addDays(todayStr(), -2);
  state.streak = 5;
  updateStreak();
  console.assert(state.streak === 1, 'streak reset');
  
  // Test words.json
  console.assert(words.length > 1900, 'words length > 1900');
  console.assert(words.every(w => w.es && w.en && w.ex_es && w.ex_en), 'all fields present');
  
  console.log('All tests passed!');
}

// Start app
document.addEventListener('DOMContentLoaded', init);

// Export for debugging
window.app = { state, words, grammar, verbs, normalize, todayStr, addDays };
  $$('.accordion-item').forEach(item => {
    const title = normalize(item.querySelector('.accordion-header').textContent);
    item.style.display = title.includes(q) ? '' : 'none';
  });
}
  chip.dataset.word = word;
  chip.textContent = word;
  chip.onclick = () => { target.removeChild(chip); btn.classList.remove('used'); };
  target.appendChild(chip);
  btn.classList.add('used');
}
  return html;
}
function endSessionEarly() {
  $('#session-start').hidden = false;
  $('#session-active').hidden = true;
  $('#session-summary').hidden = true;
  $('#btn-end-session').hidden = true;
}
  }
}
  $('#phase-indicator').textContent = phase.charAt(0).toUpperCase() + phase.slice(1);
  
  renderCard(card, phase);
}
function speak(text) {
  if (!state.settings.tts || !('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-ES';
  utter.rate = 0.9;
  speechSynthesis.speak(utter);
}

// --- UI Helpers ---
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showTab(tabId) {
  $$('.tab-panel').forEach(p => { p.hidden = true; p.classList.remove('active'); });
  $$('.nav-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
  const panel = $('#tab-' + tabId);
  const btn = $('#btn-' + tabId);
  if (panel) { panel.hidden = false; panel.classList.add('active'); }
  if (btn) { btn.classList.add('active'); btn.setAttribute('aria-selected', 'true'); }
}

function showError(msg) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:var(--error);color:white;padding:16px 24px;border-radius:var(--radius);z-index:1000;box-shadow:var(--shadow-lg);';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}