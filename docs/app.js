/* Stock Scan Premium — single-file logic (no deps, Safari-safe)
   Requirements:
   - CSV with a header row containing "Stock #"
   - Uses "Make" and "Condition"
   - Condition locked to NEW
   - Bluetooth scanner input auto-capture (no Enter required)
   - No duplicates
*/

(() => {
  const $ = (sel) => document.querySelector(sel);

  // UI
  const el = {
    file: $("#csvFile"),
    makeSel: $("#makeSel"),
    expected: $("#expected"),
    scanned: $("#scanned"),
    remaining: $("#remaining"),
    pct: $("#pct"),
    ring: document.querySelector(".progress"),
    lastScan: $("#lastScan"),
    scannedList: $("#scannedList"),
    emptyList: $("#emptyList"),
    chipCount: $("#chipCount"),
    btnExport: $("#btnExport"),
    btnReset: $("#btnReset"),
    datasetInfo: $("#datasetInfo"),
    statusText: $("#statusText"),
    statusPill: $("#statusPill"),
    toast: $("#toast"),
    dlgHelp: $("#dlgHelp"),
    btnHelp: $("#btnHelp"),
    btnCloseHelp: $("#btnCloseHelp"),
  };

  // Data
  let rows = [];                // filtered dataset rows (NEW only + make filter later)
  let allRows = [];             // NEW-only rows (before make filter)
  let makeOptions = ["All"];
  let scannedSet = new Set();   // scanned Stock # (normalized)
  let scannedOrder = [];        // keep order
  let makeFilter = "All";

  // ---------- Utilities ----------
  function norm(s){ return String(s ?? "").trim(); }
  function normKey(s){ return norm(s).toLowerCase(); }
  function showToast(msg){
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.remove("show"), 1400);
  }

  function setStatus(kind, text){
    el.statusText.textContent = text;
    const dot = el.statusPill.querySelector(".dot");
    if(!dot) return;
    const styles = {
      good: { bg: "var(--good)", glow: "rgba(64,255,155,.12)"},
      warn: { bg: "var(--warn)", glow: "rgba(255,184,74,.14)"},
      bad:  { bg: "var(--bad)",  glow: "rgba(255,92,106,.14)"}
    };
    const st = styles[kind] || styles.good;
    dot.style.background = st.bg;
    dot.style.boxShadow = `0 0 0 6px ${st.glow}`;
  }

  function downloadText(filename, text){
    const blob = new Blob([text], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 500);
  }

  // ---------- CSV parsing ----------
  // Robust enough for typical exports: handles quoted fields and commas inside quotes.
  function parseCSV(text){
    const lines = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
    // Find header row containing "Stock #"
    let headerIndex = -1;
    let headers = null;

    for(let i=0;i<lines.length;i++){
      const cols = splitCSVLine(lines[i]);
      if(cols.some(c => normKey(c) === "stock #")){
        headerIndex = i;
        headers = cols.map(c => norm(c));
        break;
      }
    }
    if(headerIndex === -1) throw new Error('Could not find header row containing "Stock #"');

    // Map header -> index
    const idx = {};
    headers.forEach((h, i) => { idx[normKey(h)] = i; });

    const need = ["stock #","make","condition"];
    for(const n of need){
      if(!(n in idx)) throw new Error(`Missing required column: ${n}`);
    }

    // Parse data rows until end; ignore empty rows and rows without Stock #
    const data = [];
    for(let i=headerIndex+1;i<lines.length;i++){
      const raw = lines[i];
      if(!raw || !raw.trim()) continue;
      const cols = splitCSVLine(raw);
      const stock = norm(cols[idx["stock #"]] ?? "");
      if(!stock) continue;

      const make = norm(cols[idx["make"]] ?? "");
      const condition = norm(cols[idx["condition"]] ?? "");
      data.push({
        stock,
        make,
        condition
      });
    }
    return data;
  }

  function splitCSVLine(line){
    const out = [];
    let cur = "";
    let inQ = false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if(ch === '"'){
        if(inQ && line[i+1] === '"'){ cur += '"'; i++; }
        else inQ = !inQ;
      } else if(ch === ',' && !inQ){
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  // ---------- Filtering ----------
  function rebuildMakeOptions(){
    const set = new Set();
    for(const r of allRows){
      if(r.make) set.add(r.make);
    }
    makeOptions = ["All", ...Array.from(set).sort((a,b)=>a.localeCompare(b))];
    el.makeSel.innerHTML = "";
    for(const m of makeOptions){
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m === "All" ? "All makes" : m;
      el.makeSel.appendChild(opt);
    }
    el.makeSel.value = makeFilter;
  }

  function applyFilters(){
    rows = allRows.filter(r => {
      if(makeFilter !== "All" && r.make !== makeFilter) return false;
      return true;
    });
    // Drop scanned items that are not in current filter from counts? No: keep scans, but counts are filter-based.
    // We'll count scanned that belong to current filtered dataset.
    renderAll();
  }

  function expectedCount(){
    return rows.length;
  }

  function scannedCountInFilter(){
    const set = new Set(rows.map(r => normKey(r.stock)));
    let c = 0;
    for(const s of scannedSet){
      if(set.has(s)) c++;
    }
    return c;
  }

  // ---------- Rendering ----------
  function setRing(p){
    const circ = 289.0; // keep in sync with CSS var --ring
    const off = Math.max(0, Math.min(circ, circ*(1 - p)));
    el.ring.style.strokeDashoffset = String(off);
  }

  function renderStats(){
    const exp = expectedCount();
    const scn = scannedCountInFilter();
    const rem = Math.max(0, exp - scn);

    el.expected.textContent = String(exp);
    el.scanned.textContent = String(scn);
    el.remaining.textContent = String(rem);
    el.pct.textContent = exp ? `${Math.round((scn/exp)*100)}%` : "0%";
    setRing(exp ? (scn/exp) : 0);

    el.btnExport.disabled = scannedOrder.length === 0;
    el.btnReset.disabled = (scannedOrder.length === 0 && allRows.length === 0);
    el.chipCount.textContent = String(scannedOrder.length);
  }

  function renderList(){
    // Show last ~200 scans
    const max = 200;
    const items = scannedOrder.slice(-max).slice().reverse();
    el.scannedList.innerHTML = "";
    if(items.length === 0){
      el.scannedList.appendChild(el.emptyList);
      el.emptyList.style.display = "block";
      return;
    }
    el.emptyList.style.display = "none";

    for(const stock of items){
      const r = findRow(stock);
      const div = document.createElement("div");
      div.className = "item";
      const left = document.createElement("div");
      left.className = "left";
      const a = document.createElement("div");
      a.className = "a mono";
      a.textContent = stock;
      const b = document.createElement("div");
      b.className = "b";
      b.textContent = r ? (r.make || "—") : "Not in dataset";
      left.appendChild(a);
      left.appendChild(b);

      const tag = document.createElement("div");
      tag.className = "chip mono";
      tag.textContent = "scanned";

      div.appendChild(left);
      div.appendChild(tag);
      el.scannedList.appendChild(div);
    }
  }

  function renderAll(){
    renderStats();
    renderList();
  }

  function findRow(stock){
    const key = normKey(stock);
    // search in allRows (NEW only)
    for(const r of allRows){
      if(normKey(r.stock) === key) return r;
    }
    return null;
  }

  // ---------- Scanning (Bluetooth HID keyboard) ----------
  // Collect rapid keypresses into a buffer. Treat as scan when idle for a short time or Enter.
  let buf = "";
  let lastKeyAt = 0;
  const GAP_MS = 60;      // scanner bursts are fast; human typing is slower
  const COMMIT_MS = 120;  // after idle, commit scan

  function commitScan(raw){
    const code = norm(raw);
    if(!code) return;

    // basic guard: ignore extremely short accidental input
    if(code.length < 3) return;

    const key = normKey(code);

    // Must exist in NEW-only dataset? We'll allow scanning unknown but warn.
    if(scannedSet.has(key)){
      setStatus("warn", "Duplicate blocked");
      showToast("Already scanned");
      flashLast(code, "warn");
      return;
    }

    scannedSet.add(key);
    scannedOrder.push(code);

    const inData = !!findRow(code);
    if(inData){
      setStatus("good", "Scan captured");
      showToast("Scan saved");
      flashLast(code, "good");
    } else {
      setStatus("warn", "Scanned not in NEW list");
      showToast("Not in NEW dataset");
      flashLast(code, "warn");
    }

    renderAll();
  }

  function flashLast(code, kind){
    el.lastScan.textContent = code;
    const box = el.lastScan.closest(".scanLine");
    if(!box) return;
    box.style.transition = "transform .12s ease, border-color .12s ease";
    box.style.transform = "scale(1.01)";
    if(kind === "good") box.style.borderColor = "rgba(64,255,155,.40)";
    else if(kind === "warn") box.style.borderColor = "rgba(255,184,74,.40)";
    else box.style.borderColor = "rgba(255,92,106,.40)";
    setTimeout(()=>{ box.style.transform="scale(1)"; box.style.borderColor="var(--stroke)"; }, 180);
  }

  function onKey(e){
    // Don't interfere with file picker or dialog controls if focused
    const tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : "";
    const isTyping = (tag === "input" || tag === "textarea" || tag === "select");
    if(isTyping) return;

    const now = Date.now();

    // If gap is large, start a new buffer
    if(now - lastKeyAt > GAP_MS) buf = "";
    lastKeyAt = now;

    if(e.key === "Enter"){
      if(buf) commitScan(buf);
      buf = "";
      return;
    }
    // Ignore modifier keys
    if(e.key.length !== 1) return;

    buf += e.key;

    clearTimeout(onKey._t);
    onKey._t = setTimeout(() => {
      if(buf) commitScan(buf);
      buf = "";
    }, COMMIT_MS);
  }

  // ---------- Actions ----------
  async function loadCSVFile(file){
    const text = await file.text();
    const data = parseCSV(text);

    // Condition locked to NEW
    allRows = data.filter(r => normKey(r.condition) === "new");
    makeFilter = "All";
    scannedSet = new Set();
    scannedOrder = [];

    rebuildMakeOptions();
    applyFilters();

    setStatus("good", "Dataset loaded (NEW only)");
    el.datasetInfo.textContent = `${file.name} • ${allRows.length} NEW items found`;
    showToast("CSV loaded");
  }

  function exportScanned(){
    // Export scanned list with Stock # and Make (if known), and flag if in NEW dataset
    const lines = [];
    lines.push(["Stock #","Make","In NEW dataset"].join(","));
    for(const stock of scannedOrder){
      const r = findRow(stock);
      const make = r ? (r.make || "") : "";
      const inNew = r ? "YES" : "NO";
      lines.push([csvEscape(stock), csvEscape(make), inNew].join(","));
    }
    downloadText(`scanned_${new Date().toISOString().slice(0,10)}.csv`, lines.join("\n"));
  }

  function csvEscape(s){
    const v = String(s ?? "");
    if(/[",\n]/.test(v)) return `"${v.replace(/"/g,'""')}"`;
    return v;
  }

  function resetAll(){
    if(allRows.length === 0 && scannedOrder.length === 0) return;
    const ok = confirm("Reset scans and clear dataset?");
    if(!ok) return;
    allRows = [];
    rows = [];
    scannedSet = new Set();
    scannedOrder = [];
    makeFilter = "All";
    el.makeSel.innerHTML = "";
    el.datasetInfo.textContent = "No dataset loaded yet.";
    el.lastScan.textContent = "—";
    setStatus("good","Ready to scan");
    renderAll();
    showToast("Reset");
  }

  // ---------- Init ----------
  function init(){
    // Populate make select default
    el.makeSel.innerHTML = `<option value="All">All makes</option>`;
    el.makeSel.value = "All";

    el.file.addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if(!f) return;
      try{
        await loadCSVFile(f);
      } catch(err){
        console.error(err);
        setStatus("bad", "CSV error");
        showToast("CSV error — check file format");
        alert(err.message || "Could not load CSV");
      } finally {
        // allow re-selecting same file
        el.file.value = "";
      }
    });

    el.makeSel.addEventListener("change", () => {
      makeFilter = el.makeSel.value;
      applyFilters();
      setStatus("good", "Ready to scan");
    });

    el.btnExport.addEventListener("click", exportScanned);
    el.btnReset.addEventListener("click", resetAll);

    // Help dialog
    el.btnHelp.addEventListener("click", () => el.dlgHelp.showModal());
    el.btnCloseHelp.addEventListener("click", () => el.dlgHelp.close());

    // Keyboard scanner listener
    window.addEventListener("keydown", onKey, {passive:true});

    renderAll();
    setStatus("good","Ready to scan");
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();