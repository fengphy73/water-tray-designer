import { LIMITS, defaultParams, derive, fmt } from './model.js';
import { buildPrintParts, meshAnalysis } from './mesh.js';
import { meshToStl } from './stl.js';
import { initPreview3d, updatePreview3d, setExploded } from './preview3d.js';

const params = defaultParams();
let exploded = false;
let latest = null;
let parts = [];
let raf = 0;

const FIELDS = Object.keys(LIMITS);

function readForm() {
  const raw = {};
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    raw[key] = el ? el.value : params[key];
  }
  return raw;
}

function writeForm(next) {
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (!el || document.activeElement === el) continue;
    const shown = String(next[key]);
    if (el.value !== shown) el.value = shown;
  }
}

function renderAlerts(warnings) {
  const box = document.getElementById('alerts');
  box.innerHTML = '';
  if (!warnings.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  for (const warning of warnings) {
    const p = document.createElement('p');
    p.className = warning.level === 'warn' ? 'alert warn' : 'alert info';
    p.textContent = warning.text;
    box.append(p);
  }
}

function row(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'dim-row';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  wrap.append(dt, dd);
  return wrap;
}

function renderSummary(spec, built) {
  const box = document.getElementById('summary');
  box.innerHTML = '';
  const items = [
    ['外殼外形', `${fmt(spec.W)} × ${fmt(spec.D)} × ${fmt(spec.H)} mm（寬 × 深 × 高）`],
    ['外殼圓角', spec.shellR > 0
      ? `外側四條直立外角 R ${fmt(spec.shellR)} mm` + (Math.abs(spec.shellRReq - spec.shellR) > 1e-9 ? `（已由 ${fmt(spec.shellRReq)} mm 限制）` : '')
      : '直角'],
    ['外殼列印', `背面貼床，佔床 ${fmt(spec.W)} × ${fmt(spec.H)} mm，列印高度 ${fmt(spec.D)} mm`],
    ['格柵蓋', `${fmt(spec.lidW)} × ${fmt(spec.lidD)} × ${fmt(spec.lidT)} mm，${spec.slotPlan.n} 條排水槽`],
    ['格柵承口', `左右凸緣之間 ${fmt(spec.openingW)} × ${fmt(spec.openingD)} mm，蓋子每側壓住約 ${fmt(spec.overlap)} mm`],
    ['集水盒外形', `${fmt(spec.boxW)} × ${fmt(spec.boxD)} × ${fmt(spec.catchBoxH)} mm（不含前方指扣）`],
    ['集水盒內部', `${fmt(spec.catchInner.w)} × ${fmt(spec.catchInner.d)} × ${fmt(spec.catchInner.h)} mm`],
    ['集水盒容量', `${fmt(spec.catchInner.mL, 0)} mL`]
  ];
  if (spec.hasDrawer) {
    items.push(
      ['抽屜外形', `${fmt(spec.boxW)} × ${fmt(spec.boxD)} × ${fmt(spec.drawerBoxH)} mm（不含前方指扣）`],
      ['抽屜內部', `${fmt(spec.drawerInner.w)} × ${fmt(spec.drawerInner.d)} × ${fmt(spec.drawerInner.h)} mm`],
      ['抽屜內部高度', `${fmt(spec.drawerInterior)} mm（底厚 ${fmt(spec.t)} mm 另計）`]
    );
  } else {
    items.push(['收納抽屜', '已省略']);
  }
  items.push(
    ['滑動間隙', `每側 ${fmt(spec.c, 2)} mm；盒體寬、深、高 = 隔間減去兩側間隙`],
    ['三角面', built.map((p) => `${p.title} ${p.analysis.triangles}`).join(' · ')]
  );
  for (const [label, value] of items) box.append(row(label, value));
  const bad = built.filter((p) => !p.analysis.watertight);
  if (bad.length) {
    const p = document.createElement('p');
    p.className = 'alert warn';
    p.textContent = `${bad.map((p) => p.title).join('、')} 的網格不是封閉單一殼，請不要直接列印。`;
    box.append(p);
  }
}

function renderDownloads(built) {
  const box = document.getElementById('downloads');
  box.innerHTML = '';
  for (const part of built) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `下載${part.title}`;
    button.addEventListener('click', () => downloadStl(part));
    box.append(button);
  }
}

function downloadStl(part) {
  const buffer = meshToStl(part.mesh, part.title);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = part.file;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  toast(`已下載 ${part.file}`);
}

function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function rebuild() {
  const spec = derive(readForm());
  Object.assign(params, spec.params);
  writeForm(spec.params);
  let built = [];
  try {
    if (!spec.planesOk) throw new Error('這個尺寸組合太擠，無法排出壁厚與間隙。');
    built = buildPrintParts(spec).map((part) => ({
      ...part,
      analysis: meshAnalysis(part.mesh.positions, part.mesh.indices)
    }));
  } catch (error) {
    spec.warnings.push({ level: 'warn', text: error.message || String(error) });
  }
  latest = spec;
  parts = built;
  renderAlerts(spec.warnings);
  renderSummary(spec, built);
  renderDownloads(built);
  const count = document.getElementById('partCount');
  count.textContent = built.length ? `${built.length} 件` : '—';
  if (built.length) updatePreview3d(spec, built);
}

function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(rebuild);
}

function saveParams() {
  const payload = { version: 1, ...derive(readForm()).params };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'water-tray-parameters.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  toast('已儲存參數');
}

function loadParams(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const next = derive(data).params;
      writeForm(next);
      schedule();
      toast('已載入參數');
    } catch (error) {
      toast('參數檔無法讀取');
    }
  };
  reader.readAsText(file);
}

function setExplode(on) {
  exploded = on;
  setExploded(on);
  const button = document.getElementById('explode');
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.classList.toggle('is-on', on);
  if (latest && parts.length) updatePreview3d(latest, parts);
  const url = new URL(location.href);
  if (on) url.hash = 'exploded';
  else url.hash = '';
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function boot() {
  writeForm(params);
  for (const key of FIELDS) {
    document.getElementById(key).addEventListener('input', schedule);
  }
  document.getElementById('saveParams').addEventListener('click', saveParams);
  document.getElementById('loadParams').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) loadParams(file);
    event.target.value = '';
  });
  document.getElementById('explode').addEventListener('click', () => setExplode(!exploded));
  initPreview3d();
  if (location.hash === '#exploded') setExplode(true);
  rebuild();
}

boot();
