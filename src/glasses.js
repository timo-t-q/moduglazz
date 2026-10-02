import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// One world unit = 42 mm. Defaults land on a typical 50-18-140 frame.
export const MM = 42;
const TAU = Math.PI * 2;
const SAMPLES = 128;

const se = (rx, ry, p, t) => {
  const c = Math.cos(t), s = Math.sin(t);
  return [rx * Math.sign(c) * Math.abs(c) ** (2 / p), ry * Math.sign(s) * Math.abs(s) ** (2 / p)];
};

// Lens outlines for the RIGHT lens (+x). Inner side (nose) is -x. Counter-clockwise.
export const FRAMES = {
  round: { rim: 0.078, bridgeH: 0.07, fn: (t) => [0.6 * Math.cos(t), 0.56 * Math.sin(t)] },
  square: { rim: 0.105, bridgeH: 0.095, fn: (t) => se(0.64, 0.47, 4.6, t) },
  aviator: {
    rim: 0.05, bridgeR: 0.03, brow: true, metal: true,
    fn: (t) => {
      let [x, y] = se(0.63, 0.54, 2.5, t);
      if (y > 0) y *= 0.8;
      else y *= 1 + 0.4 * Math.max(0, -Math.cos(t));
      return [x, y];
    },
  },
  cateye: {
    rim: 0.1, bridgeH: 0.085,
    fn: (t) => {
      let [x, y] = se(0.6, 0.43, 2.8, t);
      const w = Math.max(0, Math.cos(t)) ** 2 * Math.max(0, Math.sin(t) + 0.35) / 1.35;
      x += 0.12 * w; y += 0.34 * w;
      // taper toward the nose so the outer corner reads as a flick
      if (Math.cos(t) < 0) y *= 1 - 0.18 * -Math.cos(t);
      if (y < 0) y *= 0.88;
      return [x, y];
    },
  },
  hex: {
    rim: 0.08, bridgeH: 0.072,
    fn: (t) => {
      const seg = Math.PI / 3, R = 0.64;
      const a = (((t % seg) + seg) % seg) - seg / 2;
      const r = THREE.MathUtils.lerp((R * Math.cos(seg / 2)) / Math.cos(a), R * 0.93, 0.12);
      return [r * Math.cos(t), r * Math.sin(t) * 0.86];
    },
  },
};

export const TEMPLES = {
  slim: { h0: 0.1, h1: 0.065, th: 0.05 },
  sport: { h0: 0.24, h1: 0.09, th: 0.078 },
  wide: { h0: 0.34, h1: 0.14, th: 0.056 },
};

export const COLORS = {
  onyx: '#17181b', bone: '#e9e3d3', tortoise: '#7a4a2a', sage: '#93a88e',
  cobalt: '#2d55d8', ember: '#ff6b2c', lilac: '#b7a4e8', ice: '#d6ecf5',
};

// matte = raw printed nylon (grainy), gloss = polished and lacquered, crystal = tinted see-through
export const FINISHES = {
  matte: { roughness: 0.78, metalness: 0, clearcoat: 0, transmission: 0, grain: true },
  gloss: { roughness: 0.34, metalness: 0, clearcoat: 1, transmission: 0 },
  crystal: { roughness: 0.06, metalness: 0, clearcoat: 1, transmission: 0.95 },
  metal: { roughness: 0.22, metalness: 1, clearcoat: 0.4, transmission: 0 },
};

// irid fakes the anti-reflective coating's faint green/violet sheen
export const LENSES = {
  clear: { color: '#ffffff', mOpacity: 0.14, irid: 0.35, spec: 0.35 },
  sun: { color: '#22262b', mOpacity: 0.88, irid: 0.2, spec: 0.8 },
  blue: { color: '#fff6e6', mOpacity: 0.2, irid: 1, spec: 0.6 },
  gradient: { color: '#ffffff', mOpacity: 0.7, irid: 0.25, spec: 0.6, gradient: true },
};

export const DEFAULT_CONFIG = { frame: 'round', temple: 'slim', color: 'bone', finish: 'gloss', lens: 'clear' };
export const DEFAULT_DIMS = { lens: 50, bridge: 18, temple: 140 };

// ---------- 2D helpers ----------
function outline(frame, scale) {
  const pts = [];
  for (let i = 0; i < SAMPLES; i++) {
    const [x, y] = FRAMES[frame].fn((i / SAMPLES) * TAU);
    pts.push(new THREE.Vector2(x * scale, y * scale));
  }
  return pts;
}

function offset(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
    return new THREE.Vector2(p.x + (ty / l) * d, p.y - (tx / l) * d);
  });
}

// x where the closed polygon crosses height y, on the inner (-1) or outer (+1) side
function edgeX(pts, y, side) {
  let best = side < 0 ? Infinity : -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
    const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
    best = side < 0 ? Math.min(best, x) : Math.max(best, x);
  }
  return best;
}

function bounds(pts) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
    b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

const mirror = (pts) => pts.map((p) => new THREE.Vector2(-p.x, p.y)).reverse();

// Area-weighted normals shared by every vertex at the same position: soft, molded-looking
// surfaces, while each face keeps its own UVs for the print-grain bump map.
function smooth(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const key = (i) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  const acc = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const fn = c.sub(b).cross(a.sub(b));
    for (let j = 0; j < 3; j++) {
      const k = key(i + j);
      const v = acc.get(k);
      if (v) v.add(fn); else acc.set(k, fn.clone());
    }
  }
  for (const v of acc.values()) v.normalize();
  for (let i = 0; i < p.count; i++) { const v = acc.get(key(i)); n.setXYZ(i, v.x, v.y, v.z); }
  n.needsUpdate = true;
  return geo;
}

// ---------- 3D part geometry ----------
function rimGeometry(pts, rim, depth) {
  const shape = new THREE.Shape(offset(pts, rim));
  shape.holes.push(new THREE.Path(pts.slice().reverse()));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.036, bevelSize: 0.028, bevelSegments: 7, steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return smooth(g);
}

function lensGeometry(pts) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(offset(pts, 0.014)), {
    depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2,
  });
  g.translate(0, 0, -0.011);
  // gentle base curve so reflections roll across the lens
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, p.getZ(i) - 0.09 * (x * x + y * y));
  }
  g.computeVertexNormals();
  return g;
}

// one molded piece between the rims; its ends run into the middle of each rim so the joint disappears
function bridgeGeometry(pts, cx, rim, yB, bh, depth) {
  const mid = offset(pts, rim * 0.55);
  const xr = (y) => cx + edgeX(mid, y, -1);
  const yT = yB + bh, yL = yB - bh, S = 28, H = 10;
  const out = [];
  const xb = xr(yL), xt = xr(yT);
  for (let i = 0; i <= S; i++) { const x = -xb + (2 * xb * i) / S; out.push(new THREE.Vector2(x, yL + 0.07 * (1 - (x / xb) ** 2))); }
  for (let i = 1; i < H; i++) { const y = yL + ((yT - yL) * i) / H; out.push(new THREE.Vector2(xr(y), y)); }
  for (let i = 0; i <= S; i++) { const x = xt - (2 * xt * i) / S; out.push(new THREE.Vector2(x, yT + 0.018 * (1 - (x / xt) ** 2))); }
  for (let i = 1; i < H; i++) { const y = yT - ((yT - yL) * i) / H; out.push(new THREE.Vector2(-xr(y), y)); }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(out), {
    depth: depth * 0.92, bevelEnabled: true, bevelThickness: 0.034, bevelSize: 0.024, bevelSegments: 7, steps: 1,
  });
  g.translate(0, 0, -depth * 0.46);
  return smooth(g);
}

// three alternating knuckles and a screw head, like a real barrel hinge
function hingeGeometry(h) {
  const k = h / 3;
  const parts = [-1, 0, 1].map((i) => {
    const c = new THREE.CylinderGeometry(0.03, 0.03, k - 0.008, 18);
    c.translate(0, i * k, 0);
    return c;
  });
  const head = new THREE.CylinderGeometry(0.022, 0.022, 0.014, 18);
  head.translate(0, h / 2 + 0.007, 0);
  parts.push(head);
  return mergeGeometries(parts);
}

function templeCurve(style, L) {
  const bendAt = L * 0.72, drop = 0.5;
  return (u) => (u < bendAt ? 0 : -drop * ((u - bendAt) / (L - bendAt)) ** 2);
}

// the steel wire inside acetate arms, visible through crystal frames
function coreGeometry(style, L) {
  const center = templeCurve(style, L);
  const pts = [];
  for (let i = 0; i <= 40; i++) { const u = 0.06 + ((L * 0.86 - 0.06) * i) / 40; pts.push(new THREE.Vector3(0, center(u), -u)); }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.011, 8, false);
  g.scale(1, 1.8, 1);
  return g;
}

function templeGeometry(style, L) {
  const { h0, h1, th } = TEMPLES[style];
  const S = 64;
  const center = templeCurve(style, L);
  const height = (u) => THREE.MathUtils.lerp(h0, h1, THREE.MathUtils.smoothstep(u / L, 0, 0.55));
  const top = [], bot = [];
  for (let i = 0; i <= S; i++) {
    const u = (L * i) / S;
    top.push(new THREE.Vector2(u, center(u) + height(u) / 2));
    bot.push(new THREE.Vector2(u, center(u) - height(u) / 2));
  }
  // rounded ear tip, oriented along the curve's tangent
  const end = top[S].clone().add(bot[S]).multiplyScalar(0.5);
  const tan = new THREE.Vector2(1, (center(L) - center(L - 0.01)) / 0.01).normalize();
  const nrm = new THREE.Vector2(-tan.y, tan.x);
  const tip = [];
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    tip.push(end.clone().addScaledVector(nrm, (Math.cos(a) * h1) / 2).addScaledVector(tan, (Math.sin(a) * h1) / 2));
  }
  const shape = new THREE.Shape([...top, ...tip, ...bot.reverse()]);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: th, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 5, steps: 1,
  });
  g.translate(0, 0, -th / 2);
  g.rotateY(Math.PI / 2);
  return smooth(g);
}

function grainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 120;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  return tex;
}

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const ctx = c.getContext('2d');
  const gr = ctx.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#1d2126');
  gr.addColorStop(0.55, '#6c727a');
  gr.addColorStop(1, '#ffffff');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // ExtrudeGeometry UVs are shape coordinates; map y in [-0.75, 0.75] onto the texture
  tex.repeat.set(1 / 1.5, 1 / 1.5);
  tex.offset.set(0.5, 0.5);
  return tex;
}

// ---------- the assembled model ----------
export class Glasses {
  constructor({ lite = false } = {}) {
    this.lite = lite;
    this.config = { ...DEFAULT_CONFIG };
    this.dims = { ...DEFAULT_DIMS };

    this.printPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e3);
    this.ghostPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1e3);

    this.frameMat = new THREE.MeshPhysicalMaterial({ clippingPlanes: [this.printPlane] });
    this.lensMat = new THREE.MeshPhysicalMaterial({
      clippingPlanes: [this.printPlane], ior: 1.5, thickness: 0.04,
      iridescenceIOR: 1.6, iridescenceThicknessRange: [240, 480], roughness: 0, envMapIntensity: 0.55,
    });
    this.metalMat = new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.22, clippingPlanes: [this.printPlane] });
    this.padMat = new THREE.MeshPhysicalMaterial({
      color: '#eef4f6', roughness: 0.3, transparent: true, opacity: 0.55, clippingPlanes: [this.printPlane],
    });
    this.ghostMat = new THREE.LineBasicMaterial({
      color: '#9ad7ff', transparent: true, opacity: 0, clippingPlanes: [this.ghostPlane], depthWrite: false,
    });
    this.gradTex = gradientTexture();
    this.grainTex = grainTexture();

    this.root = new THREE.Group();
    const mk = (mat, parent = this.root) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      parent.add(m);
      return m;
    };
    const grp = () => { const g = new THREE.Group(); this.root.add(g); return g; };

    // parts, each with its own group so it can explode independently
    this.front = grp();
    this.rimL = mk(this.frameMat, this.front); this.rimR = mk(this.frameMat, this.front);
    this.endL = mk(this.frameMat, this.front); this.endR = mk(this.frameMat, this.front);
    this.brow = mk(this.frameMat, this.front);
    this.bridgeG = grp(); this.bridge = mk(this.frameMat, this.bridgeG);
    this.lensesG = grp(); this.lensL = mk(this.lensMat, this.lensesG); this.lensR = mk(this.lensMat, this.lensesG);
    this.padsG = grp(); this.padL = mk(this.padMat, this.padsG); this.padR = mk(this.padMat, this.padsG);
    this.hingeLG = grp(); this.hingeL = mk(this.metalMat, this.hingeLG);
    this.hingeRG = grp(); this.hingeR = mk(this.metalMat, this.hingeRG);
    this.pivotL = grp(); this.templeL = mk(this.frameMat, this.pivotL);
    this.pivotR = grp(); this.templeR = mk(this.frameMat, this.pivotR);
    this.coreL = mk(this.metalMat, this.templeL); this.coreR = mk(this.metalMat, this.templeR);

    this.meshes = [this.rimL, this.rimR, this.endL, this.endR, this.brow, this.bridge, this.lensL, this.lensR,
      this.padL, this.padR, this.hingeL, this.hingeR, this.templeL, this.templeR];
    for (const m of this.meshes) {
      m.userData.ghost = new THREE.LineSegments(new THREE.BufferGeometry(), this.ghostMat);
      m.userData.ghost.visible = false;
      m.add(m.userData.ghost);
    }

    // where each group sits when assembled, and which way it flies when exploded
    this.base = new Map();
    this.explodeDir = new Map([
      [this.front, new THREE.Vector3(0, 0, 0)],
      [this.lensesG, new THREE.Vector3(0, -0.15, 1.5)],
      [this.bridgeG, new THREE.Vector3(0, 0.95, 0.3)],
      [this.padsG, new THREE.Vector3(0, -1.05, 0.7)],
      [this.hingeLG, new THREE.Vector3(-0.75, 0.45, -0.1)],
      [this.hingeRG, new THREE.Vector3(0.75, 0.45, -0.1)],
      [this.pivotL, new THREE.Vector3(-1.25, -0.35, -0.7)],
      [this.pivotR, new THREE.Vector3(1.25, -0.35, -0.7)],
    ]);

    this.state = { explode: 0, fold: 0, print: 1, ghost: 0 };
    this.rebuild();
    this.applyMaterials();
  }

  set(config) {
    const prev = this.config;
    this.config = { ...this.config, ...config };
    if (prev.frame !== this.config.frame || prev.temple !== this.config.temple) this.rebuild();
    this.applyMaterials();
  }

  setDims(dims) {
    this.dims = { ...this.dims, ...dims };
    this.rebuild();
  }

  rebuild() {
    const { frame, temple } = this.config;
    const F = FRAMES[frame];
    const rim = F.rim;
    const depth = 0.12;
    const bridge = this.dims.bridge / MM;
    const templeLen = this.dims.temple / MM;

    let pts = outline(frame, 1);
    const b0 = bounds(pts);
    const scale = this.dims.lens / MM / (b0.maxX - b0.minX + 2 * rim);
    pts = pts.map((p) => p.multiplyScalar(scale));
    const b = bounds(pts);
    const outer = offset(pts, rim);
    const cx = bridge / 2 + rim - b.minX;
    this.halfWidth = cx + b.maxX + rim;

    const set = (mesh, geo) => {
      mesh.geometry.dispose();
      mesh.geometry = geo;
      const gh = mesh.userData.ghost;
      gh.geometry.dispose();
      gh.geometry = new THREE.EdgesGeometry(geo, 28);
    };

    set(this.rimR, rimGeometry(pts, rim, depth));
    set(this.rimL, rimGeometry(mirror(pts), rim, depth));
    this.rimR.position.set(cx, 0, 0);
    this.rimL.position.set(-cx, 0, 0);
    this.rimR.rotation.y = -0.05; this.rimL.rotation.y = 0.05;

    set(this.lensR, lensGeometry(pts));
    set(this.lensL, lensGeometry(mirror(pts)));
    this.lensR.position.set(cx, 0, 0);
    this.lensL.position.set(-cx, 0, 0);
    this.lensR.rotation.y = -0.05; this.lensL.rotation.y = 0.05;

    // bridge: arches between the inner rim edges
    const yB = b.maxY * 0.32;
    const xIn = cx + edgeX(outer, yB, -1) + 0.025;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(xIn, yB, 0), new THREE.Vector3(0, yB + 0.07, 0.035), new THREE.Vector3(-xIn, yB, 0),
    ]);
    if (F.metal) {
      set(this.bridge, new THREE.TubeGeometry(curve, 32, F.bridgeR, 14, false));
      this.bridge.material = this.metalMat;
    } else {
      set(this.bridge, bridgeGeometry(pts, cx, rim, yB, F.bridgeH, depth));
      this.bridge.material = this.frameMat;
    }
    this.bridge.position.set(0, 0, 0);

    // aviators get a brow bar across the top
    if (F.brow) {
      const yT = b.maxY * 0.82;
      const xa = cx + edgeX(outer, yT, -1) + 0.03;
      const brow = new THREE.CatmullRomCurve3([
        new THREE.Vector3(xa, yT, 0), new THREE.Vector3(0, yT + 0.04, 0.03), new THREE.Vector3(-xa, yT, 0),
      ]);
      set(this.brow, new THREE.TubeGeometry(brow, 32, 0.026, 10, false));
      this.brow.material = this.metalMat;
      this.brow.visible = true;
    } else this.brow.visible = false;

    // end pieces and hinges on the outer rim edge
    const yH = b.maxY * 0.45;
    const xOut = cx + edgeX(outer, yH, 1);
    const T = TEMPLES[temple];
    const endH = Math.max(0.17, T.h0 + 0.03);
    set(this.endR, new RoundedBoxGeometry(0.13, endH, 0.27, 4, 0.05));
    set(this.endL, new RoundedBoxGeometry(0.13, endH, 0.27, 4, 0.05));
    this.endR.position.set(xOut - 0.035, yH, -0.1);
    this.endL.position.set(-(xOut - 0.035), yH, -0.1);

    set(this.hingeR, hingeGeometry(endH + 0.04));
    set(this.hingeL, hingeGeometry(endH + 0.04));
    this.hingeR.position.set(0, 0, 0); this.hingeL.position.set(0, 0, 0);
    this.base.set(this.hingeRG, new THREE.Vector3(xOut - 0.01, yH, -0.245));
    this.base.set(this.hingeLG, new THREE.Vector3(-(xOut - 0.01), yH, -0.245));

    set(this.templeR, templeGeometry(temple, templeLen));
    set(this.templeL, templeGeometry(temple, templeLen));
    this.coreR.geometry.dispose(); this.coreR.geometry = coreGeometry(temple, templeLen);
    this.coreL.geometry.dispose(); this.coreL.geometry = coreGeometry(temple, templeLen);
    this.coreR.position.x = this.coreL.position.x = 0;
    this.templeR.position.set(-T.th / 2 + 0.01, 0, 0);
    this.templeL.position.set(T.th / 2 - 0.01, 0, 0);
    this.base.set(this.pivotR, new THREE.Vector3(xOut - 0.02, yH, -0.26));
    this.base.set(this.pivotL, new THREE.Vector3(-(xOut - 0.02), yH, -0.26));

    // nose pads tucked behind the inner lower rim
    const yP = b.minY * 0.32;
    const xP = cx + edgeX(pts, yP, -1) + 0.05;
    const pad = () => {
      const g = new THREE.SphereGeometry(1, 24, 16);
      g.scale(0.055, 0.105, 0.028);
      return g;
    };
    set(this.padR, pad()); set(this.padL, pad());
    this.padR.position.set(xP, yP, -0.11); this.padR.rotation.set(0, -0.55, 0.32);
    this.padL.position.set(-xP, yP, -0.11); this.padL.rotation.set(0, 0.55, -0.32);

    this.metrics = {
      cx, rim, minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY,
      yB, bridgeHalf: xIn - 0.025, halfWidth: this.halfWidth,
    };
    for (const g of [this.front, this.lensesG, this.bridgeG, this.padsG]) this.base.set(g, new THREE.Vector3());
    this.update();
  }

  applyMaterials() {
    const { color, finish, lens } = this.config;
    const f = FINISHES[finish];
    const fm = this.frameMat;
    const base = new THREE.Color(COLORS[color]);
    fm.roughness = f.roughness;
    fm.metalness = f.metalness;
    fm.clearcoat = f.clearcoat;
    fm.clearcoatRoughness = 0.04;
    fm.bumpMap = f.grain ? this.grainTex : null;
    fm.bumpScale = 0.9;
    // Transmission blends against 50% white on a transparent canvas (three.js behaviour), which made
    // everything see-through look frosted. Plain alpha blending reads as real clear plastic here.
    const crystal = finish === 'crystal';
    fm.transmission = 0;
    fm.color.copy(base);
    if (crystal) fm.color.lerp(new THREE.Color(color === 'onyx' ? '#7a828c' : '#ffffff'), 0.25);
    fm.transparent = crystal;
    fm.opacity = crystal ? 0.5 : 1;
    fm.depthWrite = !crystal;
    this.coreL.visible = this.coreR.visible = crystal;
    fm.needsUpdate = true;

    const L = LENSES[lens];
    const lm = this.lensMat;
    lm.color.set(L.color);
    lm.iridescence = L.irid;
    lm.specularIntensity = L.spec;
    lm.map = L.gradient ? this.gradTex : null;
    lm.transmission = 0;
    lm.transparent = true;
    lm.opacity = L.mOpacity;
    lm.depthWrite = false;
    lm.roughness = 0.02;
    lm.needsUpdate = true;
  }

  // explode 0..1, fold 0..1 (arms folded), print 0..1 (build-up from the bottom), ghost 0..1
  update(s = this.state) {
    Object.assign(this.state, s);
    const { explode, fold, ghost } = this.state;
    for (const [g, base] of this.base) {
      const dir = this.explodeDir.get(g) || new THREE.Vector3();
      g.position.copy(base).addScaledVector(dir, explode);
    }
    const open = -0.06;
    this.pivotR.rotation.y = THREE.MathUtils.lerp(open, Math.PI / 2 - 0.12, fold);
    this.pivotL.rotation.y = -THREE.MathUtils.lerp(open, Math.PI / 2 - 0.12, fold);
    this.pivotR.position.y -= fold * 0.02;
    this.pivotL.position.y += fold * 0.02;
    this.ghostMat.opacity = ghost * 0.8;
    for (const m of this.meshes) m.userData.ghost.visible = ghost > 0.01 && m.visible;
  }

  // world-space height range for the print sweep; the caller passes a fresh Box3
  setPrintHeight(h) {
    // while a cut is visible, render back faces so the part reads as solid instead of hollow
    const side = h < 100 ? THREE.DoubleSide : THREE.FrontSide;
    if (this.frameMat.side !== side) { this.frameMat.side = side; this.frameMat.needsUpdate = true; }
    this.printPlane.constant = h;
    this.ghostPlane.constant = -h;
  }

  // anchors for HTML labels in the exploded view
  anchors() {
    return {
      front: this.rimL, lenses: this.lensR, bridge: this.bridge, pads: this.padL,
      hinges: this.hingeL, temples: this.templeL,
    };
  }
}
