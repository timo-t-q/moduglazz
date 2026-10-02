import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import Lenis from 'lenis';
import { Glasses, FRAMES, TEMPLES, COLORS, FINISHES, LENSES, DEFAULT_CONFIG, MM } from './glasses.js';
import { initLang, setLang, getLang, onLang, t } from './i18n.js';

const lite = matchMedia('(max-width: 860px), (pointer: coarse)').matches;
// ?snap (dev only) skips easing so screenshots match the scroll position
const snap = import.meta.env.DEV && location.search.includes('snap');
const reduced = snap || matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s) => document.querySelector(s);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => v * v * (3 - 2 * v);

// ---------------------------------------------------------------- renderer
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = 0.5;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 0, 9);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.85;

const key = new THREE.DirectionalLight('#ffffff', 2.2);
key.position.set(3, 4, 6);
const rim = new THREE.DirectionalLight('#9ad7ff', 3.2);
rim.position.set(-5, 2, -4);
const fill = new THREE.DirectionalLight('#ffe9d6', 0.6);
fill.position.set(4, -3, 2);
scene.add(key, rim, fill);

const glasses = new Glasses({ lite });
const rig = new THREE.Group();
rig.add(glasses.root);
scene.add(rig);

// the laser sheet that sweeps through while a part prints
const sheetTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const sheet = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    color: '#9ad7ff', map: sheetTex, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }),
);
sheet.rotation.x = -Math.PI / 2;
scene.add(sheet);

// ---------------------------------------------------------------- scroll stops
// x, y are fractions of the half viewport; m overrides values on narrow screens
const STOPS = {
  hero: { x: 0, y: 0.18, rx: 0.12, ry: -0.45, s: 1, m: { y: 0.36, s: 0.84 } },
  partsIn: { x: 0, y: 0.02, rx: 0.25, ry: 0.55, s: 0.9, m: { y: 0.2 } },
  partsOpen: { x: 0.08, y: -0.08, rx: 0.36, ry: 0.5, s: 0.66, explode: 1, lab: 1, m: { x: 0, y: 0.24, s: 0.5 } },
  partsHold: { x: 0.08, y: -0.08, rx: 0.3, ry: 0.85, s: 0.66, explode: 1, lab: 1, m: { x: 0, y: 0.24, s: 0.5 } },
  fitA: { x: 0.36, y: 0.02, rx: 0, ry: 0, s: 0.86, dim: 1, m: { x: 0, y: 0.42, s: 0.88 } },
  fitB: { x: 0.36, y: 0.02, rx: 0, ry: 0, s: 0.86, dim: 1, m: { x: 0, y: 0.42, s: 0.88 } },
  stylesA: { x: 0, y: 0.0, rx: 0.12, ry: -0.65, s: 1.02, m: { y: 0.02 } },
  stylesB: { x: 0, y: 0.0, rx: 0.12, ry: 0.65, s: 1.02, m: { y: 0.02 } },
  procScan: { x: 0.34, y: 0, rx: 0.22, ry: -0.5, s: 0.84, print: 0, ghost: 1, m: { x: 0, y: 0.34, s: 0.8 } },
  procFit: { x: 0.34, y: 0, rx: 0.12, ry: 0, s: 0.84, print: 0, ghost: 1, m: { x: 0, y: 0.34, s: 0.8 } },
  procPrintA: { x: 0.4, y: 0, rx: 0.3, ry: 0.45, s: 0.8, explode: 0.4, print: 0, ghost: 1, m: { x: 0, y: 0.34, s: 0.56, explode: 0.22 } },
  procPrintB: { x: 0.4, y: 0, rx: 0.3, ry: 0.95, s: 0.8, explode: 0.4, print: 1, ghost: 1, m: { x: 0, y: 0.34, s: 0.56, explode: 0.22 } },
  procDone: { x: 0.34, y: 0, rx: 0.18, ry: 1.5, s: 0.84, explode: 0, print: 1, ghost: 1, m: { x: 0, y: 0.34, s: 0.8 } },
  build: { x: -0.25, y: 0.02, rx: 0.16, ry: 0.6, s: 0.68, drag: 1, m: { x: 0, y: 0.48, s: 0.66, ry: 0.35 } },
  end: { x: 0.32, y: 0.12, rx: 0.25, ry: -0.35, s: 0.7, fold: 1, m: { x: 0, y: 0.45, s: 0.66 } },
};
const DEFAULT_STATE = { x: 0, y: 0, rx: 0, ry: 0, s: 1, explode: 0, fold: 0, print: 1, ghost: 0, lab: 0, dim: 0, drag: 0 };
const KEYS = Object.keys(DEFAULT_STATE);

let stops = [];
let narrow = innerWidth <= 860;
function measure() {
  narrow = innerWidth <= 860;
  stops = [...document.querySelectorAll('.stop')].map((el) => {
    const def = STOPS[el.dataset.stop];
    const st = { ...DEFAULT_STATE, ...def, ...(narrow ? def.m : {}) };
    delete st.m;
    return { y: el.getBoundingClientRect().top + scrollY, st };
  }).sort((a, b) => a.y - b.y);
  sections = ['parts', 'fit', 'styles', 'process', 'build'].reduce((acc, id) => {
    const el = document.getElementById(id);
    acc[id] = { top: el.getBoundingClientRect().top + scrollY, h: el.offsetHeight };
    return acc;
  }, {});
}
let sections = {};

const target = { ...DEFAULT_STATE, ...STOPS.hero };
const cur = { ...target };
function sampleStops(y) {
  if (!stops.length) return;
  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].y <= y) i++;
  const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  const k = b.y > a.y ? ease(clamp01((y - a.y) / (b.y - a.y))) : 0;
  for (const key of KEYS) target[key] = a.st[key] + (b.st[key] - a.st[key]) * k;
}

// ---------------------------------------------------------------- intro
const intro = { print: reduced ? 1 : 0, ghost: reduced ? 0 : 1, fold: reduced ? 0 : 1 };
function playIntro() {
  if (reduced) return;
  const tl = gsap.timeline({ delay: 0.35 });
  tl.to(intro, { print: 1, duration: 2.6, ease: 'power2.inOut' })
    .to(intro, { ghost: 0, duration: 0.6 }, '-=0.3')
    .to(intro, { fold: 0, duration: 1.3, ease: 'power3.inOut' }, '-=0.55')
    .from('.hero-title, .lead, .actions, .hero-note', { opacity: 0, y: 24, duration: 1, stagger: 0.08, ease: 'power3.out' }, 0.9);
}

// ---------------------------------------------------------------- config switching
let userConfig = { ...DEFAULT_CONFIG };
const SHOWCASE = [
  { frame: 'round', color: 'bone', finish: 'gloss', lens: 'clear', temple: 'slim' },
  { frame: 'square', color: 'onyx', finish: 'matte', lens: 'sun', temple: 'wide' },
  { frame: 'aviator', color: 'bone', finish: 'metal', lens: 'gradient', temple: 'slim' },
  { frame: 'cateye', color: 'lilac', finish: 'gloss', lens: 'blue', temple: 'sport' },
  { frame: 'hex', color: 'ice', finish: 'crystal', lens: 'clear', temple: 'slim' },
];
const STYLE_KEYS = SHOWCASE.map((c) => c.frame);
const sweep = { v: -1 };
let swapping = null;

const same = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
function applyConfig(cfg) {
  const now = glasses.config;
  if (same(cfg, now) || (swapping && same(cfg, swapping))) return;
  const shapeChange = cfg.frame !== now.frame || cfg.temple !== now.temple;
  if (!shapeChange || reduced) {
    const from = glasses.frameMat.color.clone();
    glasses.set(cfg);
    const to = glasses.frameMat.color.clone();
    if (!reduced) {
      glasses.frameMat.color.copy(from);
      gsap.to(glasses.frameMat.color, { r: to.r, g: to.g, b: to.b, duration: 0.6, ease: 'power2.out', overwrite: true });
    }
    return;
  }
  swapping = cfg;
  gsap.killTweensOf(glasses.root.scale);
  gsap.timeline()
    .to(glasses.root.scale, { y: 0.03, x: 1.04, duration: 0.16, ease: 'power2.in' })
    .add(() => { glasses.set(swapping); swapping = null; })
    .to(glasses.root.scale, { y: 1, x: 1, duration: 0.6, ease: 'back.out(2.2)' });
  gsap.fromTo(sweep, { v: 0 }, { v: 1, duration: 0.7, ease: 'power2.out', onComplete: () => { sweep.v = -1; } });
}

// ---------------------------------------------------------------- overlays
const labelsEl = $('#labels');
const LABEL_KEYS = ['front', 'lenses', 'bridge', 'pads', 'hinges', 'temples'];
labelsEl.innerHTML = '<svg class="leaders"></svg>';
const leaders = labelsEl.firstChild;
const labelEls = LABEL_KEYS.map((k) => {
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML = `<div class="txt"><b data-i18n="part.${k}"></b><span data-i18n="part.${k}.d"></span></div>`;
  labelsEl.appendChild(el);
  return el;
});

const v3 = new THREE.Vector3();
const toScreen = (v) => {
  v.project(camera);
  return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
};
const rigCenter = new THREE.Vector3();
function updateLabels(alpha) {
  labelsEl.style.opacity = alpha.toFixed(3);
  if (alpha < 0.01) return;
  const anchors = glasses.anchors();
  rig.getWorldPosition(rigCenter);
  const [cxs, cys] = toScreen(rigCenter.clone());
  const reach = Math.min(90, innerWidth * 0.08);
  let lines = '';
  const items = LABEL_KEYS.map((k, i) => {
    const mesh = anchors[k];
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox.getCenter(v3);
    mesh.localToWorld(v3);
    const [x, y] = toScreen(v3);
    const left = x < cxs;
    const el = labelEls[i];
    // push each label away from the model's centre so it never sits on the part
    return { el, x, y, left, lx: x + (left ? -reach : reach), ly: y + Math.sign(y - cys) * reach * 0.45, w: el.offsetWidth, h: el.offsetHeight };
  });
  // keep labels on the same side from stacking on top of each other
  for (const side of [true, false]) {
    const col = items.filter((it) => it.left === side).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < col.length; i++) {
      const min = col[i - 1].ly + (col[i - 1].h + col[i].h) / 2 + 6;
      if (col[i].ly < min) col[i].ly = min;
    }
  }
  for (const it of items) {
    const { el, x, y, left, lx, ly, w, h } = it;
    lines += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/><polyline points="${x.toFixed(1)},${y.toFixed(1)} ${(lx - (left ? -12 : 12)).toFixed(1)},${ly.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)}"/>`;
    el.classList.toggle('left', left);
    const tx = Math.min(innerWidth - w - 16, Math.max(16, left ? lx - w - 8 : lx + 8));
    el.style.transform = `translate(${tx.toFixed(1)}px, ${(ly - h / 2).toFixed(1)}px)`;
  }
  leaders.innerHTML = lines;
}

const dimsEl = $('#dims');
function updateDims(alpha) {
  dimsEl.style.opacity = alpha.toFixed(3);
  if (alpha < 0.01) return;
  const m = glasses.metrics;
  const P = (x, y) => toScreen(glasses.root.localToWorld(new THREE.Vector3(x, y, 0.1)));
  const line = (a, b, label, up = true) => {
    const [x1, y1] = P(...a), [x2, y2] = P(...b);
    const tk = 6;
    const ty = up ? Math.min(y1, y2) - 10 : Math.max(y1, y2) + 20;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
      + `<line x1="${x1}" y1="${y1 - tk}" x2="${x1}" y2="${y1 + tk}"/><line x1="${x2}" y1="${y2 - tk}" x2="${x2}" y2="${y2 + tk}"/>`
      + `<text x="${(x1 + x2) / 2}" y="${ty}" text-anchor="middle">${label}</text>`;
  };
  const top = m.maxY + m.rim + 0.2;
  dimsEl.innerHTML =
    line([m.cx + m.minX - m.rim, top], [m.cx + m.maxX + m.rim, top], `${glasses.dims.lens} mm`)
    + line([-m.bridgeHalf, m.yB + 0.32], [m.bridgeHalf, m.yB + 0.32], `${glasses.dims.bridge} mm`)
    + line([-m.halfWidth, m.minY - m.rim - 0.22], [m.halfWidth, m.minY - m.rim - 0.22], `${Math.round(m.halfWidth * 2 * MM)} mm`, false);
}

// ---------------------------------------------------------------- section UI
const styleName = $('#style-name'), styleDesc = $('#style-desc'), styleCount = $('#style-count');
const styleDots = $('#style-dots');
STYLE_KEYS.forEach(() => styleDots.appendChild(document.createElement('i')));
let styleIdx = -1;
function setStyleText(i) {
  const name = t(`opt.${STYLE_KEYS[i]}`);
  styleName.textContent = name;
  styleName.style.setProperty('--n', Math.max(5, name.length));
  styleDesc.textContent = t(`style.${STYLE_KEYS[i]}.d`);
  styleCount.textContent = `${i + 1} / ${STYLE_KEYS.length}`;
  [...styleDots.children].forEach((d, j) => d.classList.toggle('on', j === i));
}
function showStyle(i) {
  if (i === styleIdx) return;
  styleIdx = i;
  setStyleText(i);
  if (!reduced) gsap.fromTo(styleName, { opacity: 0, yPercent: 12 }, { opacity: 1, yPercent: 0, duration: 0.6, ease: 'power3.out', overwrite: true });
}

const steps = [...document.querySelectorAll('#steps li')];
const readout = $('#layer-readout');
const TOTAL_LAYERS = 640;

function sectionProgress(id, y) {
  const s = sections[id];
  return s ? (y - s.top) / s.h : -1;
}

// ---------------------------------------------------------------- fit sliders
['lens', 'bridge', 'temple'].forEach((k) => {
  const input = $(`#s-${k}`), out = $(`#o-${k}`);
  input.addEventListener('input', () => {
    out.textContent = `${input.value} mm`;
    glasses.setDims({ [k]: +input.value });
  });
});

// ---------------------------------------------------------------- configurator
const PRICE = { base: 129, temple: { sport: 10, wide: 10 }, finish: { crystal: 15, metal: 29 }, lens: { sun: 20, blue: 25, gradient: 30 } };
const price = (c) => PRICE.base + (PRICE.temple[c.temple] || 0) + (PRICE.finish[c.finish] || 0) + (PRICE.lens[c.lens] || 0);

const frameIcon = (frame) => {
  const pts = [];
  for (let i = 0; i <= 48; i++) pts.push(FRAMES[frame].fn((i / 48) * Math.PI * 2));
  const d = (sx) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(28 + sx * (14 + x * 17)).toFixed(1)} ${(14 - y * 17).toFixed(1)}`).join('') + 'Z';
  return `<svg viewBox="0 0 56 28" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><path d="${d(1)}"/><path d="${d(-1)}"/></g></svg>`;
};
const templeIcon = (k) => {
  const { h0, h1 } = TEMPLES[k];
  const a = h0 * 40, b = h1 * 40;
  return `<svg viewBox="0 0 56 28" aria-hidden="true"><path fill="currentColor" d="M4 ${12 - a / 2} L40 ${12 - b / 2} Q48 ${13 - b / 2} 52 ${22 - b / 2} L52 ${22 + b / 2} Q47 ${14 + b / 2} 40 ${12 + b / 2} L4 ${12 + a / 2}Z"/></svg>`;
};
const lensIcon = (k) => {
  const fill = { clear: 'rgba(255,255,255,.12)', sun: '#2a2e33', blue: 'url(#gb)', gradient: 'url(#gg)' }[k];
  return `<svg viewBox="0 0 56 28" aria-hidden="true"><defs>
    <linearGradient id="gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2e33"/><stop offset="1" stop-color="rgba(255,255,255,.15)"/></linearGradient>
    <linearGradient id="gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb8ff" stop-opacity=".5"/><stop offset="1" stop-color="#d9a6ff" stop-opacity=".35"/></linearGradient></defs>
    <g stroke="currentColor" stroke-width="1.5" fill="${fill}"><circle cx="15" cy="14" r="10"/><circle cx="41" cy="14" r="10"/></g></svg>`;
};

const tabBody = $('#tab-body');
let activeTab = 'frame';
const optButton = (key, value, inner) =>
  `<button class="opt" type="button" data-key="${key}" data-value="${value}" aria-pressed="${userConfig[key] === value}">${inner}<span data-i18n="opt.${value}">${t(`opt.${value}`)}</span></button>`;

function renderTab() {
  const c = userConfig;
  if (activeTab === 'frame') {
    tabBody.innerHTML = `<div class="opts">${Object.keys(FRAMES).map((f) => optButton('frame', f, frameIcon(f))).join('')}</div>`;
  } else if (activeTab === 'temple') {
    tabBody.innerHTML = `<div class="opts">${Object.keys(TEMPLES).map((k) => optButton('temple', k, templeIcon(k))).join('')}</div>`;
  } else if (activeTab === 'color') {
    tabBody.innerHTML = `
      <div class="swatches">${Object.entries(COLORS).map(([k, hex]) =>
        `<button class="swatch" type="button" style="--c:${hex}" data-key="color" data-value="${k}" aria-pressed="${c.color === k}" aria-label="${t(`opt.${k}`)}" title="${t(`opt.${k}`)}"></button>`).join('')}</div>
      <p class="swatch-name">${t(`opt.${c.color}`)}</p>
      <p class="group-label" data-i18n="build.finish">${t('build.finish')}</p>
      <div class="opts">${Object.keys(FINISHES).map((k) => optButton('finish', k, '')).join('')}</div>`;
  } else {
    tabBody.innerHTML = `<div class="opts">${Object.keys(LENSES).map((k) => optButton('lens', k, lensIcon(k))).join('')}</div>`;
  }
}

function renderSummary() {
  const c = userConfig;
  const p = price(c);
  $('#summary-name').innerHTML = `${t(`opt.${c.frame}`)}, ${t(`opt.${c.color}`)}<br><span class="fine">${t(`opt.${c.finish}`)}, ${t(`opt.${c.temple}`).toLowerCase()} ${t('tab.temple').toLowerCase()}, ${t(`opt.${c.lens}`).toLowerCase()} ${t('tab.lens').toLowerCase()}</span>`;
  $('#price').textContent = getLang() === 'sk' ? `${p} €` : `€${p}`;
}

const encode = (c) => [c.frame, c.temple, c.color, c.finish, c.lens].join('-');
function decode(str) {
  const [frame, temple, color, finish, lens] = (str || '').split('-');
  const c = { ...DEFAULT_CONFIG };
  if (FRAMES[frame]) c.frame = frame;
  if (TEMPLES[temple]) c.temple = temple;
  if (COLORS[color]) c.color = color;
  if (FINISHES[finish]) c.finish = finish;
  if (LENSES[lens]) c.lens = lens;
  return c;
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  activeTab = b.dataset.tab;
  document.querySelectorAll('#tabs [data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
  renderTab();
  if (!reduced) gsap.from(tabBody.children, { opacity: 0, y: 8, duration: 0.35, stagger: 0.04, ease: 'power2.out' });
});
tabBody.addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (!b) return;
  userConfig = { ...userConfig, [b.dataset.key]: b.dataset.value };
  renderTab();
  renderSummary();
  history.replaceState(null, '', `#build=${encode(userConfig)}`);
});

const buildExplode = { v: 0 };
const explodeBtn = $('#explode-btn');
explodeBtn.addEventListener('click', () => {
  const open = buildExplode.v < 0.5;
  gsap.to(buildExplode, { v: open ? 1 : 0, duration: reduced ? 0 : 0.9, ease: 'power3.inOut' });
  explodeBtn.dataset.i18n = open ? 'build.assemble' : 'build.explode';
  explodeBtn.textContent = t(explodeBtn.dataset.i18n);
});

const copyBtn = $('#copy-btn');
copyBtn.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#build=${encode(userConfig)}`;
  try { await navigator.clipboard.writeText(url); } catch { /* clipboard blocked; the URL bar already has it */ }
  copyBtn.textContent = t('build.copied');
  setTimeout(() => { copyBtn.textContent = t('build.copy'); }, 1800);
});

// drag to rotate
const stage = $('#stage');
const userRot = { x: 0, y: 0 }, userRotCur = { x: 0, y: 0 };
let drag = null;
stage.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, rx: userRot.x, ry: userRot.y };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('dragging');
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  userRot.y = drag.ry + (e.clientX - drag.x) * 0.012;
  userRot.x = Math.max(-0.7, Math.min(0.7, drag.rx + (e.clientY - drag.y) * 0.006));
});
const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- language
$('#lang').addEventListener('click', () => setLang(getLang() === 'en' ? 'sk' : 'en'));
onLang(() => {
  if (styleIdx >= 0) setStyleText(styleIdx);
  renderTab();
  renderSummary();
});

// ---------------------------------------------------------------- smooth scroll
const lenis = reduced ? null : new Lenis({ lerp: 0.09, smoothWheel: true });
if (lenis) {
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const el = document.querySelector(a.getAttribute('href'));
  if (!el) return;
  e.preventDefault();
  if (lenis) lenis.scrollTo(el, { duration: 1.6 });
  else el.scrollIntoView();
});

// ---------------------------------------------------------------- frame loop
const mouse = { x: 0, y: 0 }, mouseCur = { x: 0, y: 0 };
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  mouse.x = e.clientX / innerWidth - 0.5;
  mouse.y = e.clientY / innerHeight - 0.5;
});

let fitScale = 1, halfW = 1, halfH = 1;
// start sharp, then step resolution down if the device can't keep up
let maxDpr = lite ? 1.5 : 1.75;
const perf = { frames: 0, t: 0 };
function adapt(dt) {
  perf.frames++; perf.t += dt;
  if (perf.t < 1.5) return;
  const fps = perf.frames / perf.t;
  perf.frames = 0; perf.t = 0;
  if (fps < 42 && maxDpr > 1 && document.visibilityState === 'visible') {
    maxDpr = Math.max(1, maxDpr - 0.25);
    renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
    renderer.setSize(innerWidth, innerHeight, false);
  }
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  halfW = halfH * camera.aspect;
  fitScale = Math.min(halfW * 2 * (camera.aspect < 0.8 ? 0.84 : 0.5), halfH * 2) / 3.0;
  measure();
}
addEventListener('resize', resize);
resize();
new ResizeObserver(() => measure()).observe(document.body);

const box = new THREE.Box3();
const clock = new THREE.Clock();
function frame() {
  const rawDt = clock.getDelta();
  adapt(rawDt);
  const dt = Math.min(rawDt, 0.1);
  const time = clock.elapsedTime;
  const y = scrollY;
  sampleStops(y);

  const k = reduced ? 1 : 1 - Math.exp(-dt * 5);
  for (const key of KEYS) cur[key] += (target[key] - cur[key]) * k;
  mouseCur.x += (mouse.x - mouseCur.x) * k;
  mouseCur.y += (mouse.y - mouseCur.y) * k;
  userRotCur.x += (userRot.x - userRotCur.x) * (1 - Math.exp(-dt * 8));
  userRotCur.y += (userRot.y - userRotCur.y) * (1 - Math.exp(-dt * 8));

  // which config should be on screen
  const pStyles = sectionProgress('styles', y);
  const inStyles = pStyles >= 0 && pStyles < 1;
  if (inStyles) {
    const q = clamp01((y - sections.styles.top) / (sections.styles.h - innerHeight));
    const i = Math.min(STYLE_KEYS.length - 1, Math.floor(q * STYLE_KEYS.length));
    showStyle(i);
    applyConfig(SHOWCASE[i]);
  } else applyConfig(userConfig);

  // process steps
  const pProc = sectionProgress('process', y);
  const step = pProc < 0.12 ? 0 : pProc < 0.28 ? 1 : pProc < 0.6 ? 2 : 3;
  steps.forEach((li, i) => li.classList.toggle('on', i === step));

  // rig transform
  const parallax = 1 - cur.drag;
  const idle = reduced ? 0 : 1;
  rig.position.set(cur.x * halfW, cur.y * halfH + Math.sin(time * 0.9) * 0.04 * idle, 0);
  rig.rotation.set(
    cur.rx + mouseCur.y * 0.22 * parallax + userRotCur.x * cur.drag,
    cur.ry + mouseCur.x * 0.45 * parallax + userRotCur.y * cur.drag + Math.sin(time * 0.35) * 0.05 * idle,
    Math.sin(time * 0.5) * 0.012 * idle,
  );
  rig.scale.setScalar(cur.s * fitScale);

  const print = Math.min(cur.print, intro.print);
  const ghost = Math.max(cur.ghost, intro.ghost);
  glasses.update({
    explode: Math.max(cur.explode, buildExplode.v * cur.drag),
    fold: Math.max(cur.fold, intro.fold),
    print, ghost,
  });

  // print plane follows the model's real height
  rig.updateMatrixWorld(true);
  box.setFromObject(glasses.root);
  const lo = box.min.y - 0.02, hi = box.max.y + 0.02;
  let h = print >= 0.999 ? 1e3 : print <= 0.001 ? -1e3 : lo + (hi - lo) * print;
  glasses.setPrintHeight(h);
  let sheetY = h, sheetOn = print > 0.001 && print < 0.999;
  if (sweep.v >= 0) { sheetY = hi + (lo - hi) * sweep.v; sheetOn = true; }
  sheet.visible = sheetOn;
  if (sheetOn) {
    const c = box.getCenter(v3);
    sheet.position.set(c.x, sheetY, c.z);
    sheet.scale.set((box.max.x - box.min.x) * 1.5, (box.max.z - box.min.z) * 1.8 + 0.6, 1);
    sheet.material.opacity = sweep.v >= 0 ? 0.6 * (1 - sweep.v) : 0.55;
  }
  const printing = pProc > 0 && pProc < 1 && print > 0.001 && print < 0.999;
  readout.style.opacity = printing ? 1 : 0;
  if (printing) readout.textContent = `${t('process.layer')} ${Math.round(print * TOTAL_LAYERS)} / ${TOTAL_LAYERS}`;

  renderer.render(scene, camera);
  updateLabels(clamp01((cur.explode - 0.5) * 2) * cur.lab);
  updateDims(clamp01(cur.dim * 1.4 - 0.4));
}
gsap.ticker.add(frame);

// ---------------------------------------------------------------- boot
initLang();
function openSharedBuild() {
  if (!location.hash.startsWith('#build=')) return false;
  userConfig = decode(location.hash.slice(7));
  renderTab();
  renderSummary();
  const go = () => {
    measure();
    if (lenis) lenis.scrollTo(sections.build.top, { immediate: true, force: true });
    else window.scrollTo(0, sections.build.top);
  };
  requestAnimationFrame(go);
  document.fonts?.ready.then(go);
  return true;
}
addEventListener('hashchange', openSharedBuild);
openSharedBuild();
glasses.set(userConfig);
renderTab();
renderSummary();
document.fonts?.ready.then(measure);
playIntro();

if (import.meta.env.DEV) window.__mg = { renderer, glasses, cur, target, get sections() { return sections; }, get stops() { return stops; }, lenis };
