import * as THREE from 'three';

// A procedural human head drawn like a 3D face scan: glowing contour lines over a black
// depth-only surface, so lines on the far side are hidden and the head reads as solid.
const g = (x, s) => Math.exp(-(x * x) / s);
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// u = angle around the vertical axis (0 = facing +z), v = angle from the top of the head
export function headPoint(u, v, out = new THREE.Vector3()) {
  const sv = Math.sin(v);
  let x = 0.62 * sv * Math.sin(u);
  const y = Math.cos(v) * 0.94;
  let z = 0.84 * sv * Math.cos(u);
  if (z < 0) z *= 1.1; // fuller back of the skull
  const jaw = sstep(-0.2, -0.95, y);
  x *= 1 - 0.3 * jaw;
  z *= z > 0 ? 1 - 0.1 * jaw : 1 - 0.5 * jaw;
  if (z > 0) {
    const ax = Math.abs(x);
    const face = sstep(0.2, 0.6, z);
    z *= 0.95;
    const ridge = sstep(0.2, -0.27, y) * sstep(-0.37, -0.27, y);
    z += 0.26 * ridge * g(x, 0.0025 + 0.007 * sstep(0.05, -0.3, y)) * face; // nose
    z -= 0.1 * g(ax - 0.24, 0.012) * g(y - 0.05, 0.008) * face;       // eye sockets
    z += 0.055 * g(y - 0.17, 0.004) * g(ax - 0.22, 0.05) * face;      // brow
    z += 0.06 * g(x, 0.02) * g(y + 0.46, 0.002) * face;               // upper lip
    z += 0.055 * g(x, 0.015) * g(y + 0.56, 0.0025) * face;            // lower lip
    z -= 0.02 * g(x, 0.03) * g(y + 0.505, 0.0005) * face;             // mouth line
    z += 0.07 * g(x, 0.04) * g(y + 0.76, 0.01) * face;                // chin
    x += Math.sign(x) * 0.03 * g(y + 0.08, 0.02) * face;              // cheekbones
  }
  x += Math.sign(x) * 0.08 * g(y + 0.02, 0.012) * g(z + 0.05, 0.008); // ears
  return out.set(x, y, z);
}

export function buildHead() {
  const group = new THREE.Group();
  const p = new THREE.Vector3();

  // depth-only surface (black on black) that hides the back of the scan
  const U = 200, V = 120, pos = [], idx = [];
  for (let j = 0; j <= V; j++) {
    for (let i = 0; i <= U; i++) {
      headPoint((i / U) * Math.PI * 2, (j / V) * Math.PI, p);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < U; i++) {
      const a = j * (U + 1) + i, b = a + U + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const surf = new THREE.BufferGeometry();
  surf.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surf.setIndex(idx);
  const blackout = new THREE.MeshBasicMaterial({ color: '#000000', polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  group.add(new THREE.Mesh(surf, blackout));
  const neckGeo = new THREE.CylinderGeometry(0.36, 0.4, 1.0, 48, 1, true);
  neckGeo.scale(1, 1, 1.1);
  neckGeo.translate(0, -1.25, -0.1);
  group.add(new THREE.Mesh(neckGeo, blackout));

  // contour lines: latitude rings of the head plus rings down the neck
  const lp = [], ly = [], ln = [];
  const SEG = 220;
  const ring = (fn) => {
    let prev = null;
    for (let i = 0; i <= SEG; i++) {
      const cur = fn((i / SEG) * Math.PI * 2).clone();
      if (prev) {
        lp.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
        ly.push(prev.y, cur.y);
        for (const q of [prev, cur]) { const nx = q.x / 0.62, nz = q.z / 0.84, l = Math.hypot(nx, nz) || 1; ln.push(nx / l, nz / l); }
      }
      prev = cur;
    }
  };
  const RINGS = 70;
  for (let k = 0; k < RINGS; k++) {
    const v = 0.1 + (k / (RINGS - 1)) * (Math.PI - 0.32);
    ring((u) => headPoint(u, v, p).multiplyScalar(1.004));
  }
  for (let k = 0; k < 12; k++) {
    const y = -0.86 - k * 0.07;
    ring((u) => p.set(Math.sin(u) * 0.375, y, Math.cos(u) * 0.41 - 0.1));
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const colors = new Float32Array(lp.length);
  lines.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const lineMesh = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(lineMesh);

  const laser = new THREE.Color('#9ad7ff');
  // scanY: height of the scan beam; lines above it are revealed. dim fades the whole head.
  // turn: the head's rotation, so lines near the silhouette glow brighter (reads as a solid form)
  group.userData.setScan = (scanY, dim = 1, turn = 0) => {
    const vx = -Math.sin(turn), vz = Math.cos(turn);
    for (let i = 0; i < ly.length; i++) {
      const y = ly[i];
      const d = y - scanY;
      const facing = Math.abs(ln[i * 2] * vx + ln[i * 2 + 1] * vz);
      const rim = 0.3 + 1.1 * (1 - facing) ** 2;
      const b = (d > 0 ? 0.55 * dim * rim : 0) + 1.6 * Math.exp(-(d * d) / 0.0025) * (scanY > -2 ? 1 : 0);
      colors[i * 3] = laser.r * b;
      colors[i * 3 + 1] = laser.g * b;
      colors[i * 3 + 2] = laser.b * b;
    }
    lines.attributes.color.needsUpdate = true;
  };
  group.userData.setScan(2);
  return group;
}
