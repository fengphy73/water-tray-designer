import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let renderer, scene, camera, controls, wrap;
let exploded = false;
let frameKey = '';
const visible = new Map();
const meshes = new Map();

export function initPreview3d() {
  wrap = document.getElementById('preview3dCanvas');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  wrap.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.5, 4000);
  camera.up.set(0, 0, 1);
  camera.position.set(120, -260, 180);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(80, 70, 50);
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const key = new THREE.DirectionalLight(0xfff6ea, 1.25);
  key.position.set(-80, -220, 260);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd5e6ea, 0.55);
  fill.position.set(180, 40, 80);
  scene.add(fill);
  const grid = new THREE.GridHelper(420, 14, 0xc5d0cc, 0xe3e6e0);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.4;
  grid.name = 'grid';
  scene.add(grid);
  const ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  resize();
  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
}

function resize() {
  if (!wrap || !renderer) return;
  const w = wrap.clientWidth || 640;
  const h = wrap.clientHeight || 480;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function geometryFromMesh(mesh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeVertexNormals();
  return geo;
}

function assemblyMatrix(place, explodeOn) {
  const extra = explodeOn ? place.explode : [0, 0, 0];
  const m = new THREE.Matrix4();
  if (place.kind === 'shell') {
    m.set(
      1, 0, 0, extra[0],
      0, 0, -1, place.depth + extra[1],
      0, 1, 0, extra[2],
      0, 0, 0, 1
    );
    return m;
  }
  m.set(
    1, 0, 0, place.x + extra[0],
    0, 1, 0, place.y + extra[1],
    0, 0, 1, place.z + extra[2],
    0, 0, 0, 1
  );
  return m;
}

function frame(spec) {
  const explodeOn = exploded;
  const reach = explodeOn ? Math.max(spec.D * 1.15, 130) : 0;
  const lift = explodeOn ? 46 : 0;
  const min = new THREE.Vector3(0, -reach, 0);
  const max = new THREE.Vector3(spec.W, spec.D, spec.H + lift);
  const center = min.clone().add(max).multiplyScalar(0.5);
  const size = Math.max(80, max.clone().sub(min).length());
  controls.target.copy(center);
  camera.near = Math.max(0.4, size / 500);
  camera.far = size * 14;
  camera.updateProjectionMatrix();
  const dist = size * (explodeOn ? 0.92 : 0.78);
  camera.position.copy(center).add(new THREE.Vector3(-dist * 0.72, -dist * 0.95, dist * 0.52));
  controls.update();
}

function syncToggles(parts) {
  const box = document.getElementById('preview3dToggles');
  const key = parts.map((p) => p.id).join(',');
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  visible.clear();
  for (const part of parts) {
    visible.set(part.id, true);
    const label = document.createElement('label');
    label.className = 'toggle-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => {
      visible.set(part.id, input.checked);
      const obj = meshes.get(part.id);
      if (obj) obj.visible = input.checked;
    });
    const swatch = document.createElement('i');
    swatch.style.background = '#' + part.color.toString(16).padStart(6, '0');
    label.append(input, swatch, document.createTextNode(part.title));
    box.append(label);
  }
}

export function setExploded(on) {
  exploded = !!on;
  frameKey = '';
}

export function updatePreview3d(spec, parts) {
  syncToggles(parts);
  for (const obj of meshes.values()) {
    scene.remove(obj);
    obj.geometry.dispose();
    obj.material.dispose();
  }
  meshes.clear();
  for (const part of parts) {
    const geo = geometryFromMesh(part.mesh);
    const mat = new THREE.MeshStandardMaterial({
      color: part.color,
      roughness: 0.58,
      metalness: 0.03,
      flatShading: true
    });
    const obj = new THREE.Mesh(geo, mat);
    obj.name = part.id;
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(assemblyMatrix(part.place, exploded));
    obj.visible = visible.get(part.id) !== false;
    scene.add(obj);
    meshes.set(part.id, obj);
  }
  const nextKey = `${exploded ? 1 : 0}:${spec.W}:${spec.D}:${spec.H}:${spec.hasDrawer ? 1 : 0}`;
  if (frameKey !== nextKey) {
    frame(spec);
    frameKey = nextKey;
  } else {
    for (const part of parts) {
      const obj = meshes.get(part.id);
      if (obj) obj.matrix.copy(assemblyMatrix(part.place, exploded));
    }
  }
}
