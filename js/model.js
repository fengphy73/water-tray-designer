/** Parameters and the derived fit between shell, lid, catch box and drawer. Units: mm. */

export const DRAWER_MIN_INTERIOR = 25;

export const LIMITS = {
  H: { min: 40, max: 200, step: 1, def: 100, label: '總高度 H' },
  W: { min: 100, max: 240, step: 1, def: 160, label: '寬度 W' },
  D: { min: 100, max: 240, step: 1, def: 140, label: '深度 D' },
  wall: { min: 2, max: 5, step: 0.5, def: 3, label: '壁厚' },
  catchDepth: { min: 15, max: 40, step: 1, def: 25, label: '集水盒深度' },
  lidT: { min: 3, max: 6, step: 0.5, def: 4, label: '格柵蓋厚' },
  slotW: { min: 2, max: 6, step: 0.5, def: 3, label: '格柵槽寬' },
  ribW: { min: 2, max: 6, step: 0.5, def: 3, label: '格柵肋寬' },
  clearance: { min: 0.2, max: 1, step: 0.1, def: 0.4, label: '滑動間隙（每側）' },
  bedX: { min: 80, max: 600, step: 1, def: 250, label: '列印平台寬' },
  bedY: { min: 80, max: 600, step: 1, def: 250, label: '列印平台深' }
};

export function defaultParams() {
  const params = {};
  for (const [key, lim] of Object.entries(LIMITS)) params[key] = lim.def;
  return params;
}

function num(value, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function sanitizeParams(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const params = {};
  const clamped = [];
  for (const [key, lim] of Object.entries(LIMITS)) {
    const before = num(src[key], lim.def);
    const next = Math.min(lim.max, Math.max(lim.min, before));
    params[key] = next;
    if (src[key] !== undefined && Math.abs(before - next) > 1e-9) clamped.push(key);
  }
  return { params, clamped };
}

/** Finger pull kept on the front wall, above the floor, clear of the side walls. */
function pullFor(boxW, boxH, t) {
  const zLo = t + 0.6;
  const zHi = boxH - 0.6;
  const avail = zHi - zLo;
  if (!(avail >= 6)) return null;
  let pullOut = 9;
  let lipH = 3.5;
  if (lipH + pullOut > avail) {
    const scale = avail / (lipH + pullOut);
    pullOut *= scale;
    lipH *= scale;
  }
  const height = lipH + pullOut;
  const pz0 = zLo + (avail - height) / 2;
  const pz1 = pz0 + height;
  const pzLip = pz1 - lipH;
  const maxW = boxW - 2 * t - 2;
  const pullW = Math.min(64, Math.max(16, Math.min(maxW, boxW * 0.46)));
  const px0 = (boxW - pullW) / 2;
  const px1 = px0 + pullW;
  return { pullOut, lipH, pullW, px0, px1, pz0, pzLip, pz1 };
}

function slotsFor(lidW, lidD, slotW, ribW, borderX, borderFront, borderBack) {
  const y0 = borderFront;
  const y1 = lidD - borderBack;
  const x0 = borderX;
  const x1 = lidW - borderX;
  const regionW = x1 - x0;
  const regionD = y1 - y0;
  if (regionW < slotW || regionD < 8) return { n: 0, slots: [], y0, y1 };
  const pitch = slotW + ribW;
  let n = Math.floor((regionW - ribW) / pitch);
  if (n < 1 && regionW >= slotW + 2) n = 1;
  if (n < 1) return { n: 0, slots: [], y0, y1 };
  const used = n * slotW + (n + 1) * ribW;
  const slots = [];
  if (used <= regionW + 1e-6) {
    let x = x0 + (regionW - used) / 2;
    for (let i = 0; i < n; i++) {
      x += ribW;
      slots.push({ x0: x, x1: x + slotW });
      x += slotW;
    }
  } else {
    const side = (regionW - slotW) / 2;
    if (side < 1) return { n: 0, slots: [], y0, y1 };
    slots.push({ x0: x0 + side, x1: x1 - side });
  }
  return { n: slots.length, slots, y0, y1 };
}

function fitsBed(sizeX, sizeY, bedX, bedY) {
  const direct = sizeX <= bedX + 0.05 && sizeY <= bedY + 0.05;
  const turned = sizeX <= bedY + 0.05 && sizeY <= bedX + 0.05;
  return { direct, turned, ok: direct || turned };
}

export function derive(raw) {
  const { params, clamped } = sanitizeParams(raw);
  const { H, W, D, wall: t, catchDepth, lidT, slotW, ribW, clearance: c, bedX, bedY } = params;
  const warnings = [];
  if (clamped.length) warnings.push({ level: 'info', text: '有參數超出允許範圍，已調整到最接近的可用值。' });

  const ledgeW = Math.max(4, t, c + 2.5);
  // H = drawer interior + catch interior + lid + 4 walls (bottom, divider, catch floor, and the two clearances' walls)
  // more directly: bottom + drawer compartment + divider + catch compartment + lid
  // drawer compartment = interior + floor + 2 clearances; catch compartment = interior + floor + 2 clearances
  const nominalDrawerInterior = H - catchDepth - lidT - 4 * t - 4 * c;
  const hasDrawer = nominalDrawerInterior >= DRAWER_MIN_INTERIOR - 1e-9;
  const drawerMinH = DRAWER_MIN_INTERIOR + catchDepth + lidT + 4 * t + 4 * c;

  const compW = W - 2 * t;
  const compD = D - t;
  const boxW = compW - 2 * c;
  const boxD = compD - 2 * c;

  let catchCompH;
  let drawerCompH = 0;
  let drawerInterior = 0;
  let catchInterior = catchDepth;
  let catchBoxH = catchDepth + t;
  let catchReduced = false;
  let zDiv0 = null;
  let zDiv1 = null;
  const zFloor = t;
  const zLid = H - lidT;

  if (hasDrawer) {
    catchCompH = catchDepth + t + 2 * c;
    drawerInterior = nominalDrawerInterior;
    drawerCompH = drawerInterior + t + 2 * c;
    zDiv0 = t + drawerCompH;
    zDiv1 = zDiv0 + t;
    catchBoxH = catchCompH - 2 * c;
    catchInterior = catchBoxH - t;
  } else {
    catchCompH = H - t - lidT;
    const maxOuter = catchCompH - 2 * c;
    const requested = catchDepth + t;
    if (requested > maxOuter + 1e-6) {
      catchBoxH = maxOuter;
      catchInterior = catchBoxH - t;
      catchReduced = true;
      warnings.push({
        level: 'warn',
        text: `集水盒盛水深度 ${fmt(catchDepth)} mm 放不進這個高度的外殼，已縮為 ${fmt(catchInterior)} mm。`
      });
    }
    warnings.push({
      level: 'info',
      text: `以目前參數，抽屜內部高度只有 ${fmt(nominalDrawerInterior)} mm，低於 ${DRAWER_MIN_INTERIOR} mm，因此省略收納抽屜與下層隔間。若要保留抽屜，總高度至少要 ${fmt(Math.ceil(drawerMinH * 10) / 10)} mm。`
    });
  }

  const recessW = compW;
  const recessD = compD;
  const lidW = recessW - 2 * c;
  const lidD = recessD - c;
  const openingW = W - 2 * t - 2 * ledgeW;
  const openingD = D - t - ledgeW;
  const overlap = ledgeW - c;
  const borderX = overlap + 1.2;
  const borderBack = overlap + 1.2;
  const borderFront = Math.max(3, ribW);
  const slotPlan = slotsFor(lidW, lidD, slotW, ribW, borderX, borderFront, borderBack);
  if (slotPlan.n === 0) {
    warnings.push({
      level: 'warn',
      text: '寬度或深度不足以切開排水槽，格柵蓋會先做成實心板。請加大寬度，或縮小槽寬、肋寬與壁厚。'
    });
  }

  const catchPull = pullFor(boxW, catchBoxH, t);
  const drawerBoxH = hasDrawer ? drawerCompH - 2 * c : 0;
  const drawerPull = hasDrawer ? pullFor(boxW, drawerBoxH, t) : null;
  const catchZ = hasDrawer ? zDiv1 + c : t + c;
  const drawerZ = t + c;

  const innerW = boxW - 2 * t;
  const innerD = boxD - 2 * t;
  const catchInner = { w: innerW, d: innerD, h: catchInterior, mL: innerW * innerD * catchInterior / 1000 };
  const drawerInner = hasDrawer ? { w: innerW, d: innerD, h: drawerInterior } : null;

  const footprints = {
    shell: { x: W, y: H, z: D },
    lid: { x: lidW, y: lidD, z: lidT },
    catch: { x: boxW, y: boxD + (catchPull ? catchPull.pullOut : 0), z: catchBoxH },
    drawer: hasDrawer ? { x: boxW, y: boxD + (drawerPull ? drawerPull.pullOut : 0), z: drawerBoxH } : null
  };

  const bedNotes = [];
  const noteFit = (name, fp) => {
    if (!fp) return;
    const fit = fitsBed(fp.x, fp.y, bedX, bedY);
    if (!fit.ok) bedNotes.push(`${name}佔床 ${fmt(fp.x)} × ${fmt(fp.y)} mm，超過列印平台 ${fmt(bedX)} × ${fmt(bedY)} mm`);
    else if (!fit.direct && fit.turned) bedNotes.push(`${name}佔床 ${fmt(fp.x)} × ${fmt(fp.y)} mm，需在平台上轉 90° 才放得下`);
  };
  noteFit('外殼', footprints.shell);
  noteFit('格柵蓋', footprints.lid);
  noteFit('集水盒', footprints.catch);
  noteFit('收納抽屜', footprints.drawer);
  if (bedNotes.length) warnings.push({ level: 'warn', text: `${bedNotes.join('。')}。` });

  const xLL = t + ledgeW;
  const xRR = W - t - ledgeW;
  const yBL = D - t - ledgeW;
  const yB = D - t;
  const planesOk = boxW > 2 * t + 4 && boxD > 2 * t + 4 && lidW > 12 && lidD > 12
    && openingW > 8 && openingD > 8 && zLid > zFloor + 4
    && xLL + 4 < xRR && yBL > 2 && yBL + 0.5 < yB
    && catchBoxH > t + 2 && catchInner.h > 1 && catchInner.w > 4 && catchInner.d > 4
    && (!hasDrawer || (zDiv0 > zFloor + 1 && zDiv1 + 1 < zLid && drawerBoxH > t + 2));

  if (!planesOk) {
    warnings.push({ level: 'warn', text: '參數組合讓內部空間過窄。請加大寬度、深度或高度，或減小壁厚。' });
  }

  return {
    params, warnings, hasDrawer, nominalDrawerInterior, drawerMinH, planesOk,
    W, D, H, t, c, lidT, ledgeW, slotW, ribW, bedX, bedY,
    catchInterior, catchReduced, catchDepth,
    zFloor, zDiv0, zDiv1, zLid, catchZ, drawerZ,
    compW, compD, catchCompH, drawerCompH, drawerInterior,
    boxW, boxD, catchBoxH, drawerBoxH,
    catchPull, drawerPull,
    recessW, recessD, openingW, openingD, lidW, lidD, overlap,
    borderX, borderBack, borderFront, slotPlan,
    catchInner, drawerInner, footprints
  };
}

export function fmt(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  const p = 10 ** digits;
  const r = Math.round((n + Number.EPSILON) * p) / p;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(digits);
}
