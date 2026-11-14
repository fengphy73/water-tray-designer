import { mkdirSync, writeFileSync } from 'fs';
import { defaultParams, derive } from '../js/model.js';
import { boundsOf, buildPrintParts, meshAnalysis } from '../js/mesh.js';
import { meshToStl } from '../js/stl.js';

const cases = [
  { name: 'default', params: defaultParams(), drawer: true },
  { name: 'H60', params: { ...defaultParams(), H: 60 }, drawer: false },
  { name: 'H200', params: { ...defaultParams(), H: 200 }, drawer: true }
];

const outDir = new URL('../tmp-output/', import.meta.url);
mkdirSync(outDir, { recursive: true });

let failed = false;
function fail(message) {
  console.error('FAIL:', message);
  failed = true;
}
function near(actual, expected, label, eps = 0.02) {
  if (Math.abs(actual - expected) > eps) {
    fail(`${label}: got ${actual.toFixed(4)} expected ${expected.toFixed(4)}`);
    return false;
  }
  return true;
}

function size(bounds, axis) {
  const min = bounds['min' + axis];
  const max = bounds['max' + axis];
  return { min, max, span: max - min };
}

for (const item of cases) {
  const spec = derive(item.params);
  console.log(`\n=== ${item.name} ===`);
  console.log(JSON.stringify({
    H: spec.H, W: spec.W, D: spec.D, wall: spec.t, clearance: spec.c,
    catchDepth: spec.catchDepth, lidT: spec.lidT,
    hasDrawer: spec.hasDrawer,
    nominalDrawerInterior: +spec.nominalDrawerInterior.toFixed(3),
    drawerInterior: +spec.drawerInterior.toFixed(3),
    catchInterior: +spec.catchInterior.toFixed(3),
    catchMLmL: +spec.catchInner.mL.toFixed(2)
  }));
  if (spec.hasDrawer !== item.drawer) fail(`${item.name} drawer flag`);
  if (item.drawer && spec.drawerInterior < 25 - 1e-6) fail(`${item.name} drawer interior under 25`);
  if (!item.drawer && spec.nominalDrawerInterior >= 25) fail(`${item.name} should omit the drawer`);

  let parts;
  try {
    parts = buildPrintParts(spec);
  } catch (error) {
    fail(`${item.name} build threw: ${error.message}`);
    continue;
  }
  const ids = parts.map((p) => p.id);
  if (item.drawer && !ids.includes('drawer')) fail(`${item.name} missing drawer mesh`);
  if (!item.drawer && ids.includes('drawer')) fail(`${item.name} should not build a drawer`);

  near(spec.boxW, spec.compW - 2 * spec.c, `${item.name} catch/drawer width`);
  near(spec.boxD, spec.compD - 2 * spec.c, `${item.name} catch/drawer depth`);
  if (spec.hasDrawer) {
    near(spec.catchBoxH, spec.catchCompH - 2 * spec.c, `${item.name} catch height`);
    near(spec.drawerBoxH, spec.drawerCompH - 2 * spec.c, `${item.name} drawer height`);
    near(spec.drawerInterior, spec.drawerBoxH - spec.t, `${item.name} drawer interior`);
    near(spec.catchInterior, spec.catchBoxH - spec.t, `${item.name} catch interior`);
  } else if (spec.catchBoxH > spec.catchCompH - 2 * spec.c + 0.05) {
    fail(`${item.name} catch box taller than the cavity allows`);
  }
  near(spec.lidW, spec.recessW - 2 * spec.c, `${item.name} lid width`);
  near(spec.lidD, spec.recessD - spec.c, `${item.name} lid depth`);
  if (!(spec.lidW > spec.openingW + 1)) fail(`${item.name} lid falls through the ledge opening in X`);
  if (!(spec.lidD > spec.openingD + 1)) fail(`${item.name} lid falls through the ledge opening in Y`);
  near(spec.overlap, (spec.lidW - spec.openingW) / 2, `${item.name} side overlap`);
  near(spec.overlap, spec.lidD - spec.openingD, `${item.name} back overlap`);

  for (const part of parts) {
    const analysis = meshAnalysis(part.mesh.positions, part.mesh.indices);
    const b = boundsOf(part.mesh);
    const sx = size(b, 'X');
    const sy = size(b, 'Y');
    const sz = size(b, 'Z');
    const info = {
      file: part.file,
      watertight: analysis.watertight,
      openEdges: analysis.openEdges,
      nonManifoldEdges: analysis.nonManifoldEdges,
      components: analysis.components,
      volume: +analysis.volume.toFixed(3),
      triangles: analysis.triangles,
      bbox: `X ${sx.min.toFixed(2)}–${sx.max.toFixed(2)} (${sx.span.toFixed(2)})  Y ${sy.min.toFixed(2)}–${sy.max.toFixed(2)} (${sy.span.toFixed(2)})  Z ${sz.min.toFixed(2)}–${sz.max.toFixed(2)} (${sz.span.toFixed(2)})`
    };
    console.log(JSON.stringify(info));
    if (!analysis.watertight || analysis.volume <= 0 || analysis.components !== 1) {
      fail(`${item.name} ${part.id} is not a watertight single shell`);
      if (analysis.openSamples.length) console.error('open edges', JSON.stringify(analysis.openSamples));
    }
    if (sx.min < -0.05 || sy.min < -0.05 || sz.min < -0.05) fail(`${item.name} ${part.id} is not on the bed`);
    const bboxVol = sx.span * sy.span * sz.span;
    if (!(analysis.volume < bboxVol * 0.92)) fail(`${item.name} ${part.id} volume looks solid rather than shelled`);
    writeFileSync(new URL(`${item.name}-${part.file}`, outDir), Buffer.from(meshToStl(part.mesh, part.title)));
  }

  const byId = Object.fromEntries(parts.map((p) => [p.id, boundsOf(p.mesh)]));
  const shell = byId.shell;
  near(shell.maxX - shell.minX, spec.W, `${item.name} shell width`);
  near(shell.maxY - shell.minY, spec.H, `${item.name} shell height on bed`);
  near(shell.maxZ - shell.minZ, spec.D, `${item.name} shell depth`);
  const lid = byId.lid;
  near(lid.maxX - lid.minX, spec.lidW, `${item.name} lid mesh width`);
  near(lid.maxY - lid.minY, spec.lidD, `${item.name} lid mesh depth`);
  near(lid.maxZ - lid.minZ, spec.lidT, `${item.name} lid mesh thickness`);
  const pull = spec.catchPull ? spec.catchPull.pullOut : 0;
  const catchB = byId.catch;
  near(catchB.maxX - catchB.minX, spec.boxW, `${item.name} catch mesh width`);
  near(catchB.maxY - catchB.minY, spec.boxD + pull, `${item.name} catch mesh depth with pull`);
  near(catchB.maxZ - catchB.minZ, spec.catchBoxH, `${item.name} catch mesh height`);
  if (spec.slotPlan.n > 0) {
    const lidAnalysis = meshAnalysis(parts.find((p) => p.id === 'lid').mesh.positions, parts.find((p) => p.id === 'lid').mesh.indices);
    const solidPlate = spec.lidW * spec.lidD * spec.lidT;
    if (!(lidAnalysis.volume < solidPlate * 0.97)) fail(`${item.name} grille slots did not remove material`);
  }
  if (spec.hasDrawer) {
    const dPull = spec.drawerPull ? spec.drawerPull.pullOut : 0;
    const drawer = byId.drawer;
    near(drawer.maxX - drawer.minX, spec.boxW, `${item.name} drawer mesh width`);
    near(drawer.maxY - drawer.minY, spec.boxD + dPull, `${item.name} drawer mesh depth with pull`);
    near(drawer.maxZ - drawer.minZ, spec.drawerBoxH, `${item.name} drawer mesh height`);
  }

  console.log(JSON.stringify({
    fit: {
      compartment: { W: +spec.compW.toFixed(3), D: +spec.compD.toFixed(3), catchH: +spec.catchCompH.toFixed(3), drawerH: +spec.drawerCompH.toFixed(3) },
      body: { W: +spec.boxW.toFixed(3), D: +spec.boxD.toFixed(3), catchH: +spec.catchBoxH.toFixed(3), drawerH: +spec.drawerBoxH.toFixed(3) },
      clearanceEachSide: spec.c,
      minus2Clearance: +(2 * spec.c).toFixed(3),
      lid: { W: +spec.lidW.toFixed(3), D: +spec.lidD.toFixed(3), T: spec.lidT },
      recess: { W: +spec.recessW.toFixed(3), D: +spec.recessD.toFixed(3) },
      ledgeOpening: { W: +spec.openingW.toFixed(3), D: +spec.openingD.toFixed(3) },
      overlapMm: +spec.overlap.toFixed(3),
      slots: spec.slotPlan.n,
      catchInner: spec.catchInner,
      drawerInner: spec.drawerInner
    }
  }));
}

if (failed) {
  console.error('\nCHECK FAILED');
  process.exit(1);
}
console.log('\nCHECK PASSED');
