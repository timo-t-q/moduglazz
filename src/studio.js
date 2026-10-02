import * as THREE from 'three';

// A dark product-photography studio: black room, a top softbox, two side strips and a cool
// back light. Gloss frames pick up clean highlights and clear lenses stay clear instead of grey.
export function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#020203');
  const panel = (w, h, pos, intensity, color = '#ffffff') => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(7, 3.5, [0, 7, 1.5], 2.6);            // top softbox
  panel(1.1, 7, [-6.5, 0.5, 3.5], 3.4);       // left strip
  panel(1.1, 7, [6.5, 0.5, 3.5], 3.4);        // right strip
  panel(9, 2.2, [0, 1.5, -7], 1.6, '#9ad7ff'); // back rim
  panel(5, 1.2, [0, -6, 3], 0.35);            // floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  return env;
}
