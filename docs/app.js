// Stock Scan – Premium iPad-first build (Bluetooth default + Camera backup)
// Condition locked to NEW, Make filter, no duplicates, persistence on refresh.

const STORAGE_KEY = 'stockscan_premium_v2';

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

let state = {
  rows: [],
  scanned: new Set(),        // all scanned Stock# values
  make: '',
  lastScan: '',
};

// ---------- Build premium layout using your existing HTML ----------
function ensurePremiumLayout(){
  if (document.getElementById('layout')) return;

  // Wrap filters content for styling
  if (!document.querySelector('#filters .left')) {
    const left = document.createElement('div');
    left.className = 'left';
    const make = els.makeFilter;
    const lock = document.querySelector('#filters .lock');
    left.appendChild(make);
    left.appendChild(lock);

    els.makeFilter.parentElement.insertBefore(left, els.makeFilter);
    // remove original siblings if duplicated
    // (makeFilter already moved)
  }

  const status = document.getElementById('status');
  const msg = document.getElementById('message');

  const layout = document.createElement('div');
  layout.id = 'layout';

  const leftCol = document.createElement('div');
  leftCol.id = 'leftCol';

  const rightCol = document.createElement('div');
  rightCol.id = 'rightCol';

  // Left column content
  const leftPad = document.createElement('div');
  leftPad.className = 'sectionPad';

  const pillRow = document.createElement('div');
  pillRow.style.display = 'flex';
  pillRow.style.gap = '10px';
  pillRow.style.flexWrap = 'wrap';
  pillRow.style.marginBottom = '12px';

  const pill = document.createElement('span');
  pill.id = 'statePill';
  pill.className = 'pill';
  pill.textContent = 'No file loaded';

  pillRow.appendChild(pill);

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.innerHTML =
    `<b>Bluetooth:</b> just scan — no Enter needed.<br/>
     <b>Camera:</b> tap the 📷 button (Safari will ask permission once).<br/>
     <b>Locked:</b> Condition = <b>NEW</b>. Duplicates are ignored.`;

  leftPad.appendChild(pillRow);
  leftPad.appendChild(status);
  leftPad.appendChild(hint);

  leftCol.appendChild(leftPad);

  // Right column content (scan hero)
  const rightPad = document.createElement('div');
  rightPad.className = 'sectionPad';

  const hero = document.createElement('div');
  hero.id = 'scanHero';

  const title = document.createElement('h2');
  title.id = 'scanTitle';
  title.textContent = 'READY TO SCAN';

  const sub = document.createElement('p');
  sub.id = 'scanSub';
  sub.textContent = 'Upload your CSV once, then scan NEW stock by Make. Progress is saved even if you refresh.';

  const ringWrap = document.createElement('div');
  ringWrap.className = 'ringWrap';
  ringWrap.id = 'ringWrap';

  const ringInner = document.createElement('div');
  ringInner.className = 'ringInner';

  const pct = document.createElement('div');
  pct.id = 'ringPct';
  pct.textContent = '0%';

  const label = document.createElement('div');
  label.id = 'ringLabel';
  label.textContent = 'Complete';

  ringInner.appendChild(pct);
  ringInner.appendChild(label);
  ringWrap.appendChild(ringInner);

  const last = document.createElement('div');
  last.id = 'lastScan';
  last.textContent = 'Last scan: —';

  hero.appendChild(title);
  hero.appendChild(sub);
  hero.appendChild(ringWrap);
  hero.appendChild(last);

  // Replace old message placement with pill + hero, but keep message node for accessibility/debug
  msg.style.display = 'none';

  rightPad.appendChild(hero);
  rightCol.appendChild(rightPad);

  // Insert layout after filters
  const filters = document.getElementById('filters');
  filters.insertAdjacentElement('afterend', layout);
  layout.appendChild(leftCol);
  layout.appendChild(rightCol);

  // Camera modal
  const modal = document.createElement('div');
  modal.id = 'camModal';
  modal.innerHTML = `
    <div id="camCard">
      <div id="camTop">
        <strong>Scan with Camera</strong>
        <button id="camClose">Close</button>
      </div>
      <div id="camBody">
        <video id="camVideo" playsinline></video>
        <div id="camHint">Point the camera at the barcode. It will scan automatically.</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function setPill(kind, text){
  const pill = document.getElementById('statePill');
  if (!pill) return;
  pill.className = 'pill' + (kind ? ` ${kind}` : '');
  pill.textContent = text;
}

function setLastScan(code){
  state.lastScan = code || '';
  const el = document.getElementById('lastScan');
  if (el) el.textContent = `Last scan: ${code || '—'}`;
}

function flashSuccess(){
  const ring = document.getElementById('ringWrap');
  if (!ring) return;
  ring.classList.remove('flash');
  void ring.offsetWidth; // reflow
  ring.classList.add('flash');
}

// ---------- Persistence ----------
function saveState(){
  const payload = {
    rows: state.rows,
    scanned: Array.from(state.scanned),
    make: state.make,
    lastScan: state.lastScan,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try{
    const s = JSON.parse(raw);
    state.rows = Array.isArray(s.rows) ? s.rows : [];
    state.scanned = new Set(Array.isArray(s.scanned) ? s.scanned : []);
    state.make = typeof s.make === 'string' ? s.make : '';
    state.lastScan = typeof s.lastScan === 'string' ? s.lastScan : '';
  }catch{}
}

// ---------- CSV parsing (handles quoted commas) ----------
function parseCSV(text){
  const lines = text.split(/\r?\n/);

  // Find header row containing "Stock #"
  let headerIndex = -1;
  for (let i=0;i<lines.length;i++){
    if (lines[i] && lines[i].toLowerCase().includes('stock #')) { headerIndex = i; break; }
  }
  if (headerIndex === -1) return [];

  const headers = splitCSVLine(lines[headerIndex]).map(h => (h||'').trim());
  const rows = [];

  for (let i=headerIndex+1;i<lines.length;i++){
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const vals = splitCSVLine(line);

    // Ignore junk footer rows that don't have Stock #
    const stock = (vals[headers.indexOf('Stock #')] || '').trim();
    if (!stock) continue;

    const row = {};
    for (let c=0;c<headers.length;c++){
      row[headers[c]] = (vals[c] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line){
  const out = [];
  let cur = '';
  let inQ = false;

  for (let i=0;i<line.length;i++){
    const ch = line[i];

    if (ch === '"'){
      if (inQ && line[i+1] === '"'){ // escaped quote
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }

    if (ch === ',' && !inQ){
      out.push(cur);
      cur = '';
      continue;
    }

    cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------- Filters and counts ----------
function norm(s){ return String(s ?? '').trim().toLowerCase(); }

function getFilteredRows(){
  const m = state.make;
  return state.rows.filter(r => {
    const cond = norm(r['Condition']);
    const make = (r['Make'] ?? '').trim();
    return cond === 'new' && (!m || make === m);
  });
}

function countScannedInFiltered(filtered){
  let n = 0;
  for (const r of filtered){
    const code = (r['Stock #'] ?? '').trim();
    if (code && state.scanned.has(code)) n++;
  }
  return n;
}

function populateMakes(){
  const makes = Array.from(new Set(state.rows.map(r => (r['Make'] ?? '').trim()).filter(Boolean))).sort();
  els.makeFilter.innerHTML = `<option value="">All Makes</option>`;
  for (const m of makes){
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    els.makeFilter.appendChild(opt);
  }
  els.makeFilter.value = state.make || '';
}

function updateUI(){
  const filtered = getFilteredRows();
  const expected = filtered.length;
  const scanned = countScannedInFiltered(filtered);
  const remaining = Math.max(expected - scanned, 0);

  els.expectedCount.textContent = String(expected);
  els.scannedCount.textContent = String(scanned);
  els.remainingCount.textContent = String(remaining);

  const pct = expected ? Math.round((scanned / expected) * 100) : 0;
  const ring = document.querySelector('.ringWrap');
  if (ring) ring.style.setProperty('--p', String(pct));
  const pctEl = document.getElementById('ringPct');
  if (pctEl) pctEl.textContent = `${pct}%`;

  setLastScan(state.lastScan);

  if (!state.rows.length){
    setPill('', 'No file loaded');
  } else if (expected === 0){
    setPill('bad', 'No NEW items for this filter');
  } else if (remaining === 0){
    setPill('good', 'Complete');
  } else {
    setPill('', 'In progress');
  }
}

// ---------- Bluetooth scan capture (no Enter required) ----------
let kbBuffer = '';
let kbTimer = null;

function onKeydown(e){
  // Don’t steal input when user is using dropdown
  const a = document.activeElement;
  if (a && (a.tagName === 'SELECT' || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;

  // Ignore modifier keys
  if (e.key.length !== 1) return;

  kbBuffer += e.key;

  if (kbTimer) clearTimeout(kbTimer);
  kbTimer = setTimeout(() => {
    const code = kbBuffer.trim();
    kbBuffer = '';
    if (code) handleScan(code, 'bluetooth');
  }, 55); // scanners send fast bursts; 55ms works well on iOS
}

function handleScan(code, source){
  if (!state.rows.length){
    setPill('bad', 'Upload CSV first');
    return;
  }

  // must exist in filtered NEW + make list
  const filtered = getFilteredRows();
  const found = filtered.find(r => (r['Stock #'] ?? '').trim() === code);

  if (!found){
    setPill('bad', 'Not in NEW list');
    setLastScan(code);
    saveState();
    updateUI();
    return;
  }

  if (state.scanned.has(code)){
    setPill('bad', 'Duplicate ignored');
    setLastScan(code);
    saveState();
    updateUI();
    return;
  }

  state.scanned.add(code);
  state.lastScan = code;
  saveState();
  updateUI();
  flashSuccess();

  // gentle “back to normal” pill
  setTimeout(() => {
    updateUI();
  }, 450);
}

// ---------- CSV upload ----------
els.uploadBtn.addEventListener('click', () => els.fileInput.click());

els.fileInput.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (state.rows.length){
    const ok = confirm('Start a new stock check? This will clear current scans.');
    if (!ok){
      els.fileInput.value = '';
      return;
    }
  }

  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    const rows = parseCSV(text);

    state.rows = rows;
    state.scanned = new Set();
    state.make = '';
    state.lastScan = '';

    populateMakes();
    saveState();
    updateUI();
    els.fileInput.value = '';

    setPill(rows.length ? '' : 'bad', rows.length ? 'READY TO SCAN' : 'Could not read CSV');
  };
  reader.readAsText(file);
});

els.makeFilter.addEventListener('change', () => {
  state.make = els.makeFilter.value || '';
  saveState();
  updateUI();
});

// ---------- Camera scanning (BarcodeDetector API) ----------
let camStream = null;
let camDetector = null;
let camRunning = false;
let camRaf = null;

function camEls(){
  return {
    modal: document.getElementById('camModal'),
    close: document.getElementById('camClose'),
    video: document.getElementById('camVideo'),
    hint: document.getElementById('camHint'),
  };
}

async function openCamera(){
  if (!state.rows.length){
    setPill('bad', 'Upload CSV first');
    return;
  }

  const c = camEls();
  c.modal.style.display = 'block';

  c.close.onclick = closeCamera;

  // BarcodeDetector support check
  if (!('BarcodeDetector' in window)){
    c.hint.textContent = 'This iOS version does not support camera barcode detection. Use Bluetooth scanner.';
    return;
  }

  try{
    camDetector = new window.BarcodeDetector({
      formats: ['code_128','ean_13','ean_8','upc_a','upc_e','code_39','itf','qr_code']
    });

    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });

    c.video.srcObject = camStream;
    await c.video.play();

    camRunning = true;
    c.hint.textContent = 'Point the camera at the barcode. It will scan automatically.';

    scanLoop();
  }catch(err){
    c.hint.textContent = 'Camera permission denied or unavailable. Use Bluetooth scanner or allow camera in Safari settings.';
  }
}

function closeCamera(){
  const c = camEls();
  c.modal.style.display = 'none';
  camRunning = false;

  if (camRaf) cancelAnimationFrame(camRaf);
  camRaf = null;

  try{
    if (camStream){
      for (const t of camStream.getTracks()) t.stop();
    }
  }catch{}
  camStream = null;
  camDetector = null;
}

async function scanLoop(){
  if (!camRunning) return;
  const c = camEls();

  try{
    const barcodes = await camDetector.detect(c.video);
    if (barcodes && barcodes.length){
      const raw = (barcodes[0].rawValue || '').trim();
      if (raw){
        handleScan(raw, 'camera');
        closeCamera();
        return;
      }
    }
  }catch{
    // ignore per-frame errors
  }

  camRaf = requestAnimationFrame(scanLoop);
}

els.cameraBtn.addEventListener('click', openCamera);

// ---------- Init ----------
ensurePremiumLayout();
loadState();

if (state.rows.length){
  populateMakes();
  els.makeFilter.value = state.make || '';
  setPill('', 'READY TO SCAN');
} else {
  setPill('', 'No file loaded');
}

setLastScan(state.lastScan || '');
updateUI();

document.addEventListener('keydown', onKeydown);
