import React, { useMemo } from 'react';
import * as THREE from 'three';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import { loadFont as loadDisplay } from '@remotion/google-fonts/Unbounded';
import { loadFont as loadBody } from '@remotion/google-fonts/InstrumentSans';
import { Glasses, DEFAULT_CONFIG } from '../src/glasses.js';
import { studioEnvironment } from '../src/studio.js';
import { buildHead } from './head.js';

const { fontFamily: display } = loadDisplay('normal', { weights: ['500', '700'] });
const { fontFamily: body } = loadBody('normal', { weights: ['400', '500'] });

const LASER = '#9ad7ff';
const COPY = {
  en: ['Scan your face.', 'We print to your measurements.', 'Swap any part.', 'Printed for one face. Yours.', 'Student company, Inventure 2026'],
  sk: ['Naskenuj si tvár.', 'Vytlačíme ich na tvoje mierky.', 'Vymeň hociktorý diel.', 'Vytlačené pre jednu tvár. Tvoju.', 'Študentská firma, Inventure 2026'],
};

// frame → which pair is on the face
const SWAPS = [
  { at: 0, cfg: DEFAULT_CONFIG },
  { at: 128, cfg: { frame: 'cateye', temple: 'sport', color: 'cobalt', finish: 'gloss', lens: 'blue' } },
  { at: 143, cfg: { frame: 'square', temple: 'wide', color: 'ember', finish: 'matte', lens: 'sun' } },
  { at: 158, cfg: { frame: 'aviator', temple: 'slim', color: 'bone', finish: 'metal', lens: 'gradient' } },
  { at: 174, cfg: DEFAULT_CONFIG },
];

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const ease = Easing.bezier(0.65, 0, 0.35, 1);

function makeSheet() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    color: LASER, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Everything in the 3D world is a pure function of the frame number, so Remotion can render
// frames in any order across parallel tabs.
function useWorld() {
  return useMemo(() => {
    const world = new THREE.Group();
    const head = buildHead();
    const glasses = new Glasses({ lite: false });
    const rig = new THREE.Group();
    rig.add(glasses.root);
    const sheet = makeSheet();
    world.add(head, rig);
    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(3, 4, 6);
    const rim = new THREE.DirectionalLight(LASER, 3);
    rim.position.set(-5, 2, -4);
    const lights = [key, rim];
    return { world, head, glasses, rig, sheet, lights, box: new THREE.Box3() };
  }, []);
}

function cameraFor(frame, wide) {
  const z = interpolate(frame, [0, 170, 210], [6.9, 5.6, 6.2], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return { pos: [wide ? -1.25 : 0, 0.1, z], look: [wide ? -1.25 : 0, wide ? -0.15 : -0.3, 0] };
}

function Scene({ w, cam }) {
  const { gl, scene, camera } = useThree();
  // set up synchronously so the very first rendered frame already has lighting
  if (!scene.userData.ready) {
    gl.localClippingEnabled = true;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    scene.environment = studioEnvironment(gl);
    scene.userData.ready = true;
  }
  camera.position.set(...cam.pos);
  camera.lookAt(...cam.look);
  camera.updateProjectionMatrix();
  return (
    <>
      <primitive object={w.world} />
      <primitive object={w.sheet} />
      {w.lights.map((l, i) => <primitive key={i} object={l} />)}
    </>
  );
}

function Words({ text, start, end, frame, fps, size, weight = 500, family = display }) {
  const words = text.split(' ');
  const out = interpolate(frame, [end - 8, end], [1, 0], clamp);
  return (
    <div style={{ fontFamily: family, fontSize: size, fontWeight: weight, lineHeight: 1.02, letterSpacing: '-0.035em', color: '#f2f1ee', opacity: out }}>
      {words.map((wd, i) => {
        const s = spring({ frame: frame - start - i * 3, fps, config: { damping: 18, mass: 0.6 } });
        return (
          <span key={i} style={{ display: 'inline-block', marginRight: '0.24em', opacity: s, transform: `translateY(${(1 - s) * 0.5}em)` }}>{wd}</span>
        );
      })}
    </div>
  );
}

export const Promo = ({ lang = 'en' }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const wide = width > height;
  const w = useWorld();
  const copy = COPY[lang] || COPY.en;

  // ---- head scan
  const scanY = interpolate(frame, [4, 52], [1.15, -1.75], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const headDim = interpolate(frame, [170, 196], [1, 0.32], clamp);
  w.world.rotation.y = interpolate(frame, [0, 110, 210], [-1.05, -0.42, -0.62], { ...clamp, easing: Easing.inOut(Easing.sin) });
  w.head.userData.setScan(frame < 54 ? scanY : -3, headDim, w.world.rotation.y);
  w.world.rotation.x = 0.06;
  w.world.position.x = wide ? 0 : 0.2;

  // ---- which pair, plus the squash-and-pop between pairs
  let cfg = SWAPS[0].cfg, squash = 1;
  for (const s of SWAPS) if (frame >= s.at) cfg = s.cfg;
  for (const s of SWAPS.slice(1)) {
    if (frame >= s.at - 4 && frame < s.at) squash = interpolate(frame, [s.at - 4, s.at], [1, 0.04]);
    if (frame >= s.at && frame < s.at + 14) squash = 0.04 + 0.96 * spring({ frame: frame - s.at, fps, config: { damping: 9, mass: 0.4 } });
  }
  w.glasses.set(cfg);

  // ---- glasses: ghost → print in front of the face → slide onto the face
  const appear = interpolate(frame, [56, 66], [0, 1], clamp);
  const print = interpolate(frame, [66, 102], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const onFace = spring({ frame: frame - 104, fps, config: { damping: 14, mass: 0.7 } });
  const fold = interpolate(frame, [96, 114], [1, 0], { ...clamp, easing: ease });
  w.glasses.update({ explode: 0, fold, print: frame < 56 ? 0 : print, ghost: frame < 56 ? 0 : appear });
  // splay the arms out over the ears once they're open
  const splay = 0.14 * (1 - fold);
  w.glasses.pivotR.rotation.y -= splay;
  w.glasses.pivotL.rotation.y += splay;
  w.rig.visible = frame >= 56;
  const gs = 0.355 * (0.85 + 0.15 * appear);
  w.rig.scale.set(gs, gs * squash, 0.355);
  w.rig.position.set(0, 0.035 + (1 - onFace) * 0.06, 0.9 + (1 - onFace) * 0.5);
  w.rig.rotation.set((1 - onFace) * -0.08, (1 - onFace) * 0.35, 0);
  w.world.updateMatrixWorld(true);

  // ---- print plane + laser sheet, same as the website
  w.box.setFromObject(w.glasses.root);
  const lo = w.box.min.y - 0.01, hi = w.box.max.y + 0.01;
  const h = print >= 0.999 ? 1e3 : print <= 0.001 ? -1e3 : lo + (hi - lo) * print;
  w.glasses.setPrintHeight(frame < 56 ? -1e3 : h);
  let sheetY = h, sheetOn = frame >= 66 && print > 0.001 && print < 0.999, sheetA = 0.6;
  for (const s of SWAPS.slice(1)) {
    if (frame >= s.at && frame < s.at + 9) {
      const k = (frame - s.at) / 9;
      sheetY = hi + (lo - hi) * k; sheetOn = true; sheetA = 0.7 * (1 - k);
    }
  }
  w.sheet.visible = sheetOn;
  if (sheetOn) {
    const c = w.box.getCenter(new THREE.Vector3());
    w.sheet.position.set(c.x, sheetY, c.z);
    w.sheet.scale.set((w.box.max.x - w.box.min.x) * 1.5, (w.box.max.z - w.box.min.z) * 1.6 + 0.4, 1);
    w.sheet.material.opacity = sheetA;
  }

  // ---- measurement chips
  const cam = cameraFor(frame, wide);
  const chips = [
    { at: 70, k: 'lens', v: w.glasses.dims.lens },
    { at: 75, k: 'bridge', v: w.glasses.dims.bridge },
    { at: 80, k: 'temple', v: w.glasses.dims.temple },
  ];
  const chipsOut = interpolate(frame, [106, 114], [1, 0], clamp);
  const chipNames = lang === 'sk' ? { lens: 'Sklo', bridge: 'Mostík', temple: 'Stranica' } : { lens: 'Lens', bridge: 'Bridge', temple: 'Arm' };

  const s = width / 1080;
  const capSize = (wide ? 84 : 92) * s;
  const pad = 80 * s;
  const capBox = wide
    ? { position: 'absolute', left: 120 * s, top: '50%', transform: 'translateY(-50%)', width: 760 * s }
    : { position: 'absolute', left: pad, right: pad, bottom: 250 * s };

  const endIn = spring({ frame: frame - 176, fps, config: { damping: 20 } });

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ background: `radial-gradient(55% 40% at ${wide ? '68%' : '50%'} 42%, rgba(154,215,255,0.10), transparent 70%)` }} />
      <ThreeCanvas width={width} height={height} camera={{ fov: 30, near: 0.1, far: 100, position: cam.pos }} gl={{ antialias: true, alpha: true }}>
        <Scene w={w} cam={cam} />
      </ThreeCanvas>

      {/* measurement chips */}
      <div style={{ position: 'absolute', right: wide ? 150 * s : 70 * s, top: wide ? 300 * s : 330 * s, display: 'grid', gap: 16 * s, justifyItems: 'end' }}>
        {chips.map((c) => {
          const k = spring({ frame: frame - c.at, fps, config: { damping: 16 } }) * chipsOut;
          return (
            <div key={c.k} style={{
              opacity: k, transform: `translateX(${(1 - k) * 40 * s}px)`, display: 'flex', gap: 14 * s, alignItems: 'baseline',
              fontFamily: body, fontSize: 34 * s, color: '#8d9097', whiteSpace: 'nowrap',
            }}>
              {chipNames[c.k]}
              <span style={{ fontWeight: 500, color: '#000', background: LASER, padding: `${6 * s}px ${16 * s}px`, borderRadius: 999, fontVariantNumeric: 'tabular-nums' }}>{c.v} mm</span>
            </div>
          );
        })}
      </div>

      {/* captions */}
      <div style={capBox}>
        {frame < 54 && <Words text={copy[0]} start={8} end={54} frame={frame} fps={fps} size={capSize} />}
        {frame >= 58 && frame < 120 && <Words text={copy[1]} start={60} end={120} frame={frame} fps={fps} size={capSize} />}
        {frame >= 122 && frame < 172 && <Words text={copy[2]} start={124} end={172} frame={frame} fps={fps} size={capSize} />}
        {frame >= 174 && <Words text={copy[3]} start={178} end={999} frame={frame} fps={fps} size={capSize * 0.9} />}
      </div>

      {/* end card wordmark */}
      <div style={{
        position: 'absolute', left: wide ? 120 * s : pad, top: wide ? 110 * s : 140 * s,
        display: 'flex', alignItems: 'center', gap: 22 * s, opacity: endIn, transform: `translateY(${(1 - endIn) * 30 * s}px)`,
      }}>
        <svg width={92 * s} height={46 * s} viewBox="0 0 64 32"><g fill="none" stroke={LASER} strokeWidth="4"><circle cx="15" cy="16" r="11" /><circle cx="49" cy="16" r="11" /><path d="M26 14q6-6 12 0" /></g></svg>
        <span style={{ fontFamily: display, fontWeight: 500, fontSize: 64 * s, letterSpacing: '-0.03em', color: '#f2f1ee' }}>moduglazz</span>
      </div>
      <div style={{
        position: 'absolute', left: wide ? 120 * s : pad, bottom: (wide ? 110 : 130) * s,
        fontFamily: body, fontSize: 32 * s, color: '#8d9097', opacity: interpolate(frame, [186, 198], [0, 1], clamp),
      }}>{copy[4]}</div>
    </AbsoluteFill>
  );
};
