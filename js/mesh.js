/**
 * Watertight shells for the water tray.
 * One mesh builder feeds both the STL and the 3D preview.
 *
 * Assembly axes (used to derive the fit): X width, Y depth (0 = front), Z height.
 * STL / preview buffers are print-ready:
 *   shell  — back face on the bed (opening up). Print X = width, Y = height, Z = depth.
 *   lid    — flat, slots vertical.
 *   trays  — bottom on the bed, finger pull toward −Y of the assembly and +Y = 0 on the bed.
 */
import { fmt } from './model.js';

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.idx = [];
    this.map = new Map();
  }
  v(x, y, z) {
    const k = `${round4(x)},${round4(y)},${round4(z)}`;
    let i = this.map.get(k);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.pos.push(round4(x), round4(y), round4(z));
      this.map.set(k, i);
    }
    return i;
  }
  tri(a, b, c) {
    if (a === b || b === c || a === c) return;
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  quadP(p, q, r, s) {
    this.quad(
      this.v(p[0], p[1], p[2]),
      this.v(q[0], q[1], q[2]),
      this.v(r[0], r[1], r[2]),
      this.v(s[0], s[1], s[2])
    );
  }
}

function triArea(pos, a, b, c) {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(nx, ny, nz);
}

function volumeOf(pos, idx) {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Make winding consistent, then flip so the enclosed volume is positive. */
export function finalizeMesh(posIn, idxIn) {
  const pos = posIn;
  const raw = [];
  for (let i = 0; i < idxIn.length; i += 3) {
    const a = idxIn[i], b = idxIn[i + 1], c = idxIn[i + 2];
    if (a === b || b === c || a === c) continue;
    if (triArea(pos, a, b, c) < 1e-10) continue;
    raw.push([a, b, c]);
  }
  const n = raw.length;
  const edgeMap = new Map();
  const key = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  for (let i = 0; i < n; i++) {
    const [a, b, c] = raw[i];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      let arr = edgeMap.get(k);
      if (!arr) edgeMap.set(k, arr = []);
      arr.push(i);
    }
  }
  const seen = new Uint8Array(n);
  const flip = new Uint8Array(n);
  const dirs = (ti) => {
    let a = raw[ti][0], b = raw[ti][1], c = raw[ti][2];
    if (flip[ti]) [b, c] = [c, b];
    return [[a, b], [b, c], [c, a]];
  };
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const ti = stack.pop();
      for (const [a, b] of dirs(ti)) {
        const arr = edgeMap.get(key(a, b)) || [];
        for (const nj of arr) {
          if (nj === ti || seen[nj]) continue;
          const same = dirs(nj).some(([c, d]) => c === a && d === b);
          if (same) flip[nj] = 1;
          seen[nj] = 1;
          stack.push(nj);
        }
      }
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    let [a, b, c] = raw[i];
    if (flip[i]) [b, c] = [c, b];
    idx.push(a, b, c);
  }
  if (volumeOf(pos, idx) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
  }
  const used = new Map();
  const posOut = [];
  const idxOut = [];
  const mapV = (id) => {
    let nId = used.get(id);
    if (nId === undefined) {
      nId = posOut.length / 3;
      used.set(id, nId);
      posOut.push(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
    }
    return nId;
  };
  for (let i = 0; i < idx.length; i += 3) {
    const a = mapV(idx[i]), b = mapV(idx[i + 1]), c = mapV(idx[i + 2]);
    if (a === b || b === c || a === c) continue;
    if (triArea(posOut, a, b, c) < 1e-10) continue;
    idxOut.push(a, b, c);
  }
  return {
    positions: Float32Array.from(posOut),
    indices: Uint32Array.from(idxOut)
  };
}

export function meshAnalysis(positions, indices) {
  const pos = positions;
  const idx = indices;
  const edge = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  let degenerates = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (triArea(pos, a, b, c) < 1e-12) degenerates++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      edge.set(k, (edge.get(k) || 0) + 1);
    }
  }
  let open = 0, nonManifold = 0;
  const openSamples = [];
  for (const [k, count] of edge) {
    if (count === 1) {
      open++;
      if (openSamples.length < 6) {
        const [ia, ib] = k.split('_').map(Number);
        openSamples.push({
          a: [pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]],
          b: [pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]]
        });
      }
    } else if (count > 2) nonManifold++;
  }
  const parent = new Uint32Array(pos.length / 3);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < idx.length; i += 3) {
    unite(idx[i], idx[i + 1]);
    unite(idx[i], idx[i + 2]);
  }
  const roots = new Set();
  const used = new Set();
  for (let i = 0; i < idx.length; i++) used.add(idx[i]);
  for (const v of used) roots.add(find(v));
  const volume = volumeOf(pos, idx);
  return {
    triangles: idx.length / 3,
    vertices: used.size,
    openEdges: open,
    nonManifoldEdges: nonManifold,
    components: roots.size,
    volume,
    degenerates,
    openSamples,
    watertight: open === 0 && nonManifold === 0 && roots.size === 1 && volume > 0
  };
}

export function boundsOf(mesh) {
  const p = mesh.positions;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function uniquePlanes(vals) {
  const sorted = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    if (!out.length || Math.abs(v - out[out.length - 1]) > 1e-6) out.push(v);
  }
  return out;
}

function assertIncreasing(planes, label) {
  for (let i = 1; i < planes.length; i++) {
    if (!(planes[i] > planes[i - 1] + 1e-6)) {
      throw new Error(`${label} 的分割面沒有嚴格遞增：${planes.map((n) => fmt(n, 3)).join(', ')}`);
    }
  }
}

/**
 * Boundary of a rectilinear solid. `isSolid(i,j,k)` describes the cell
 * between planes. Exterior cells are empty, so outer faces are included.
 */
function emitGrid(mesh, xs, ys, zs, isSolid, skip) {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const nz = zs.length - 1;
  const solid = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return false;
    return isSolid(i, j, k);
  };
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        const left = solid(i - 1, j, k);
        const right = solid(i, j, k);
        if (left === right) continue;
        if (skip && skip({ axis: 'x', plane: i, j, k })) continue;
        const x = xs[i], y0 = ys[j], y1 = ys[j + 1], z0 = zs[k], z1 = zs[k + 1];
        if (left && !right) mesh.quadP([x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]);
        else mesh.quadP([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]);
      }
    }
  }
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const back = solid(i, j - 1, k);
        const front = solid(i, j, k);
        if (back === front) continue;
        if (skip && skip({ axis: 'y', plane: j, i, k })) continue;
        const y = ys[j], x0 = xs[i], x1 = xs[i + 1], z0 = zs[k], z1 = zs[k + 1];
        if (back && !front) mesh.quadP([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]);
        else mesh.quadP([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
      }
    }
  }
  for (let k = 0; k <= nz; k++) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const below = solid(i, j, k - 1);
        const above = solid(i, j, k);
        if (below === above) continue;
        if (skip && skip({ axis: 'z', plane: k, i, j })) continue;
        const z = zs[k], x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
        if (below && !above) mesh.quadP([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
        else mesh.quadP([x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z]);
      }
    }
  }
}

function addPull(mesh, pull, yWall) {
  const { pullOut, px0, px1, pz0, pzLip, pz1 } = pull;
  const yOut = yWall - pullOut;
  mesh.quadP([px0, yOut, pz1], [px1, yOut, pz1], [px1, yWall, pz1], [px0, yWall, pz1]);
  mesh.quadP([px0, yOut, pzLip], [px1, yOut, pzLip], [px1, yOut, pz1], [px0, yOut, pz1]);
  mesh.quadP([px0, yWall, pz0], [px1, yWall, pz0], [px1, yOut, pzLip], [px0, yOut, pzLip]);
  mesh.quadP([px0, yWall, pz0], [px0, yOut, pzLip], [px0, yOut, pz1], [px0, yWall, pz1]);
  mesh.quadP([px1, yWall, pz0], [px1, yWall, pz1], [px1, yOut, pz1], [px1, yOut, pzLip]);
}

function buildShellAssembly(spec) {
  const { W, D, H, t, ledgeW, hasDrawer, zDiv0, zDiv1 } = spec;
  const xs = [0, t, t + ledgeW, W - t - ledgeW, W - t, W];
  const ys = [0, D - t - ledgeW, D - t, D];
  const zs = hasDrawer ? [0, t, zDiv0, zDiv1, H - spec.lidT, H] : [0, t, H - spec.lidT, H];
  assertIncreasing(xs, '外殼寬度');
  assertIncreasing(ys, '外殼深度');
  assertIncreasing(zs, '外殼高度');
  const mesh = new MeshBuilder();
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const nz = zs.length - 1;
  const isSolid = (i, j, k) => {
    if (k === 0) return true;
    if (i === 0 || i === nx - 1) return true;
    if (j === ny - 1) return true;
    if (hasDrawer && k === 2) return true;
    if (k === nz - 1) {
      if (i === 1 || i === nx - 2) return true;
      if (i === 2 && j === 1) return true;
      return false;
    }
    return false;
  };
  emitGrid(mesh, xs, ys, zs, isSolid, null);
  return finalizeMesh(mesh.pos, mesh.idx);
}

/** Rotate the shell so the back face sits on z = 0. Proper rotation, volume sign unchanged. */
function orientShell(mesh, depth) {
  const src = mesh.positions;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i];
    out[i + 1] = src[i + 2];
    out[i + 2] = depth - src[i + 1];
  }
  return { positions: out, indices: mesh.indices };
}

function buildLid(spec) {
  const { lidW, lidD, lidT, slotPlan } = spec;
  const xs = [0, lidW];
  const ys = [0, lidD];
  if (slotPlan.n > 0) {
    ys.push(slotPlan.y0, slotPlan.y1);
    for (const slot of slotPlan.slots) {
      xs.push(slot.x0, slot.x1);
    }
  }
  const xu = uniquePlanes(xs);
  const yu = uniquePlanes(ys);
  const zs = [0, lidT];
  assertIncreasing(xu, '格柵蓋寬度');
  assertIncreasing(yu, '格柵蓋深度');
  const mesh = new MeshBuilder();
  const isSolid = (i, j) => {
    if (!slotPlan.slots.length) return true;
    const cx = (xu[i] + xu[i + 1]) / 2;
    const cy = (yu[j] + yu[j + 1]) / 2;
    if (cy <= slotPlan.y0 || cy >= slotPlan.y1) return true;
    for (const slot of slotPlan.slots) {
      if (cx > slot.x0 && cx < slot.x1) return false;
    }
    return true;
  };
  emitGrid(mesh, xu, yu, zs, (i, j) => isSolid(i, j), null);
  return finalizeMesh(mesh.pos, mesh.idx);
}

function buildTray(boxW, boxD, boxH, t, pull) {
  const yWall = pull ? pull.pullOut : 0;
  const xs = uniquePlanes([0, t, pull ? pull.px0 : null, pull ? pull.px1 : null, boxW - t, boxW]);
  const ys = uniquePlanes([yWall, yWall + t, yWall + boxD - t, yWall + boxD]);
  const zs = uniquePlanes([0, t, pull ? pull.pz0 : null, pull ? pull.pz1 : null, boxH]);
  assertIncreasing(xs, '抽盒寬度');
  assertIncreasing(ys, '抽盒深度');
  assertIncreasing(zs, '抽盒高度');
  const mesh = new MeshBuilder();
  const isSolid = (i, j, k) => {
    if ((zs[k] + zs[k + 1]) / 2 < t) return true;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    if (cx < t || cx > boxW - t) return true;
    if (cy < yWall + t || cy > yWall + boxD - t) return true;
    return false;
  };
  let skipped = 0;
  const skip = pull ? (face) => {
    if (face.axis !== 'y' || face.plane !== 0) return false;
    const cx = (xs[face.i] + xs[face.i + 1]) / 2;
    const cz = (zs[face.k] + zs[face.k + 1]) / 2;
    const hit = cx > pull.px0 && cx < pull.px1 && cz > pull.pz0 && cz < pull.pz1;
    if (hit) skipped += 1;
    return hit;
  } : null;
  emitGrid(mesh, xs, ys, zs, isSolid, skip);
  if (pull) {
    if (skipped !== 1) throw new Error(`指扣開口應剛好是一個面，實際跳過 ${skipped} 個面。`);
    addPull(mesh, pull, yWall);
  }
  return finalizeMesh(mesh.pos, mesh.idx);
}

const COLORS = {
  shell: 0xd7d2c8,
  lid: 0x3d7ea6,
  catch: 0x7eb6d4,
  drawer: 0xc4843c
};

function part(id, file, title, mesh, place) {
  return { id, file, title, mesh, place, color: COLORS[id] };
}

/** Print-oriented meshes. `place` maps that buffer into the assembled stand. */
export function buildPrintParts(spec) {
  if (!spec.planesOk) throw new Error('參數組合無法生成封閉零件。');
  const shell = orientShell(buildShellAssembly(spec), spec.D);
  const lid = buildLid(spec);
  const catchMesh = buildTray(spec.boxW, spec.boxD, spec.catchBoxH, spec.t, spec.catchPull);
  const catchPull = spec.catchPull ? spec.catchPull.pullOut : 0;
  const parts = [
    part('shell', 'shell.stl', '外殼', shell, {
      kind: 'shell',
      depth: spec.D,
      explode: [0, 0, 0]
    }),
    part('lid', 'grille.stl', '格柵蓋', lid, {
      kind: 'shift',
      x: spec.t + spec.c,
      y: 0,
      z: spec.H - spec.lidT,
      explode: [0, 0, 36]
    }),
    part('catch', 'catch-box.stl', '集水盒', catchMesh, {
      kind: 'shift',
      x: spec.t + spec.c,
      y: spec.c - catchPull,
      z: spec.catchZ,
      explode: [0, -Math.max(56, spec.D * 0.5), 0]
    })
  ];
  if (spec.hasDrawer) {
    const drawerMesh = buildTray(spec.boxW, spec.boxD, spec.drawerBoxH, spec.t, spec.drawerPull);
    const drawerPull = spec.drawerPull ? spec.drawerPull.pullOut : 0;
    parts.push(part('drawer', 'drawer.stl', '收納抽屜', drawerMesh, {
      kind: 'shift',
      x: spec.t + spec.c,
      y: spec.c - drawerPull,
      z: spec.drawerZ,
      explode: [0, -Math.max(118, spec.D * 0.95), 10]
    }));
  }
  return parts;
}
