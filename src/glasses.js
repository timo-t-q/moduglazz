import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  round: { rim: 0.075, bridgeR: 0.045, fn: (t) => [0.6 * Math.cos(t), 0.56 * Math.sin(t)] },
  square: { rim: 0.105, bridgeR: 0.06, fn: (t) => se(0.64, 0.47, 4.6, t) },
  aviator: {
    rim: 0.05, bridgeR: 0.03, brow: true,
    fn: (t) => {
      let [x, y] = se(0.63, 0.54, 2.5, t);
      if (y > 0) y *= 0.8;
      else y *= 1 + 0.4 * Math.max(0, -Math.cos(t));
      return [x, y];
    },
  },
  cateye: {
    rim: 0.1, bridgeR: 0.05,
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
    rim: 0.08, bridgeR: 0.04,
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

export const FINISHES = {
  matte: { roughness: 0.6, metalness: 0, clearcoat: 0, transmission: 0 },
  gloss: { roughness: 0.16, metalness: 0, clearcoat: 1, transmission: 0 },
  crystal: { roughness: 0.1, metalness: 0, clearcoat: 1, transmission: 0.9 },
  metal: { roughness: 0.26, metalness: 1, clearcoat: 0, transmission: 0 },
};

export const LENSES = {
  clear: { color: '#ffffff', mOpacity: 0.18, irid: 0 },
  sun: { color: '#24282d', mOpacity: 0.88, irid: 0 },
  blue: { color: '#fff6e6', mOpacity: 0.22, irid: 1 },
  gradient: { color: '#ffffff', mOpacity: 0.7, irid: 0.25, gradient: true },
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

function smooth(geo) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-4);
  g.computeVertexNormals();
  geo.dispose();
  return g;
}

// ---------- 3D part geometry ----------
function rimGeometry(pts, rim, depth) {
  const shape = new THREE.Shape(offset(pts, rim));
  shape.holes.push(new THREE.Path(pts.slice().reverse()));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.022, bevelSegments: 4, steps: 1,
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

function templeGeometry(style, L) {
  const { h0, h1, th } = TEMPLES[style];
  const bendAt = L * 0.72, drop = 0.5, S = 64;
  const center = (u) => (u < bendAt ? 0 : -drop * ((u - bendAt) / (L - bendAt)) ** 2);
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
    depth: th, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, steps: 1,
  });
  g.translate(0, 0, -th / 2);
  g.rotateY(Math.PI / 2);
  return smooth(g);
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
      clippingPlanes: [this.printPlane], roughness: 0.04, ior: 1.5, thickness: 0.06,
      iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 620], specularIntensity: 0.7, envMapIntensity: 0.6,
    });
    this.metalMat = new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.22, clippingPlanes: [this.printPlane] });
    this.padMat = new THREE.MeshPhysicalMaterial({
      color: '#eef4f6', roughness: 0.3, transparent: true, opacity: 0.55, clippingPlanes: [this.printPlane],
    });
    this.ghostMat = new THREE.LineBasicMaterial({
      color: '#9ad7ff', transparent: true, opacity: 0, clippingPlanes: [this.ghostPlane], depthWrite: false,
    });
    this.gradTex = gradientTexture();

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
    set(this.bridge, new THREE.TubeGeometry(curve, 32, F.bridgeR, 14, false));
    this.bridge.position.set(0, 0, 0);

    // aviators get a brow bar across the top
    if (F.brow) {
      const yT = b.maxY * 0.82;
      const xa = cx + edgeX(outer, yT, -1) + 0.03;
      const brow = new THREE.CatmullRomCurve3([
        new THREE.Vector3(xa, yT, 0), new THREE.Vector3(0, yT + 0.04, 0.03), new THREE.Vector3(-xa, yT, 0),
      ]);
      set(this.brow, new THREE.TubeGeometry(brow, 32, 0.026, 10, false));
      this.brow.visible = true;
    } else this.brow.visible = false;

    // end pieces and hinges on the outer rim edge
    const yH = b.maxY * 0.45;
    const xOut = cx + edgeX(outer, yH, 1);
    const T = TEMPLES[temple];
    const endH = Math.max(0.17, T.h0 + 0.03);
    set(this.endR, new RoundedBoxGeometry(0.13, endH, 0.27, 3, 0.035));
    set(this.endL, new RoundedBoxGeometry(0.13, endH, 0.27, 3, 0.035));
    this.endR.position.set(xOut - 0.035, yH, -0.1);
    this.endL.position.set(-(xOut - 0.035), yH, -0.1);

    set(this.hingeR, new THREE.CylinderGeometry(0.026, 0.026, endH + 0.05, 14));
    set(this.hingeL, new THREE.CylinderGeometry(0.026, 0.026, endH + 0.05, 14));
    this.hingeR.position.set(0, 0, 0); this.hingeL.position.set(0, 0, 0);
    this.base.set(this.hingeRG, new THREE.Vector3(xOut - 0.01, yH, -0.245));
    this.base.set(this.hingeLG, new THREE.Vector3(-(xOut - 0.01), yH, -0.245));

    set(this.templeR, templeGeometry(temple, templeLen));
    set(this.templeL, templeGeometry(temple, templeLen));
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
    fm.color.set(finish === 'crystal' && color === 'onyx' ? '#4a4f57' : COLORS[color]);
    fm.roughness = f.roughness;
    fm.metalness = f.metalness;
    fm.clearcoat = f.clearcoat;
    fm.clearcoatRoughness = 0.06;
    if (this.lite) {
      // phones: fake translucency instead of a transmission pass
      fm.transmission = 0;
      fm.transparent = f.transmission > 0;
      fm.opacity = f.transmission > 0 ? 0.62 : 1;
    } else {
      fm.transmission = f.transmission;
      fm.thickness = 0.35;
      fm.transparent = false;
      fm.opacity = 1;
    }
    fm.needsUpdate = true;

    const L = LENSES[lens];
    const lm = this.lensMat;
    lm.color.set(L.color);
    lm.iridescence = L.irid;
    lm.map = L.gradient ? this.gradTex : null;
    if (this.lite) {
      lm.transmission = 0;
      lm.transparent = true;
      lm.opacity = L.mOpacity;
      lm.depthWrite = false;
      lm.roughness = 0.05;
    } else {
      lm.transmission = 1;
      lm.transparent = false;
      lm.opacity = 1;
      lm.depthWrite = true;
    }
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
