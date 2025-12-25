/* ===============================
   STOCK SCAN – PREMIUM VERSION
   =============================== */

const STORAGE_KEY = 'stockscan_state_v1';

let state = {
  rows: [],
  filtered: [],
  scanned: new Set(),
  make: '',
};

const els = {
  uploadBtn: document.getElementById('uploadBtn'),
  fileInput: document.getElementById('fileInput'),
  makeFilter: document.getElementById('makeFilter'),
  scannedCount: document.getElementById('scannedCount'),
  remainingCount: document.getElementById('remainingCount'),
  expectedCount: document.getElementById('expectedCount'),
  message: document.getElementById('message'),
  cameraBtn: document.getElementById('cameraBtn'),
};

/* ---------- Persistence ---------- */

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    rows: state.rows,
    scanned: [...state.scanned],
    make: state.make,
  }));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    state.rows = s.rows || [];
    state.scanned = new Set(s.scanned || []);
    state.make = s.make || '';
  } catch {}
}

/* ---------- CSV Parsing ---------- */

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  let headerIndex = lines.findIndex(l => l.includes('Stock #'));
  if (headerIndex === -1) return [];

  const headers = lines[headerIndex].split(',').map(h => h.trim());
  const rows = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (!values[0]) continue;
    const row = {};
    headers.forEach((h, idx) => row[h] = (values[idx] || '').trim());
    rows.push(row);
  }
  return rows;
}

/* ---------- UI ---------- */

function updateCounts() {
  els.scannedCount.textContent = state.scanned.size;
  els.expectedCount.textContent = state.filtered.length;
  els.remainingCount.textContent =
    Math.max(state.filtered.length - state.scanned.size, 0);
}

function updateFilter() {
  state.filtered = state.rows.filter(r =>
    r.Condition.toLowerCase() === 'new' &&
    (!state.make || r.Make === state.make)
  );
  updateCounts();
}

function populateMakes() {
  const makes = [...new Set(state.rows.map(r => r.Make))].sort();
  els.makeFilter.innerHTML = '<option value="">All Makes</option>';
  makes.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    els.makeFilter.appendChild(opt);
  });
  els.makeFilter.value = state.make;
}

/* ---------- Scanning ---------- */

let buffer = '';
let lastTime = 0;

document.addEventListener('keydown', e => {
  const now = Date.now();
  if (now - lastTime > 100) buffer = '';
  lastTime = now;

  if (e.key.length === 1) {
    buffer += e.key;
  }

  if (buffer.length >= 3) {
    handleScan(buffer);
    buffer = '';
  }
});

function handleScan(code) {
  if (!state.filtered.length) return;

  const found = state.filtered.find(r => r['Stock #'] === code);
  if (!found) return;

  if (state.scanned.has(code)) return;

  state.scanned.add(code);
  saveState();
  updateCounts();
}

/* ---------- Camera Scan ---------- */

els.cameraBtn.addEventListener('click', async () => {
  alert('Camera scanning uses Bluetooth scanner preferred.\nCamera support can be added later if needed.');
});

/* ---------- Events ---------- */

els.uploadBtn.addEventListener('click', () => els.fileInput.click());

els.fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  if (state.rows.length && !confirm('Start a new stock check?')) return;

  const reader = new FileReader();
  reader.onload = () => {
    state.rows = parseCSV(reader.result);
    state.scanned.clear();
    state.make = '';
    populateMakes();
    updateFilter();
    saveState();
    els.message.textContent = 'READY TO SCAN';
  };
  reader.readAsText(file);
});

els.makeFilter.addEventListener('change', e => {
  state.make = e.target.value;
  updateFilter();
  saveState();
});

/* ---------- Init ---------- */

loadState();
if (state.rows.length) {
  populateMakes();
  updateFilter();
  els.message.textContent = 'READY TO SCAN';
}
updateCounts();
