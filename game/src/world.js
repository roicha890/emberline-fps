// The EMBERLINE map: "Kiln Yard" — a compact dusk-industrial yard with three lanes
// (kiln hall, mid yard, loading dock), a bombsite A on the east end, two team spawns on
// the north and south sides. Every box is a collider and a shootable surface; plain
// geometry only, the palette and lighting do the art.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP_BOUNDS = { x: 23, z: 30 };  // half-extents of the outer walls
export const SITE_A = { x: 14, z: 0, radius: 4.2 };   // bombsite A centre
export const SPAWN_ATTACK = [[-18, -24], [-15, -26], [-20, -22], [-13, -23], [-17, -27]];
export const SPAWN_DEFEND = [[-18, 24], [-15, 26], [-20, 22], [-13, 23], [-17, 27]];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // ---- outer shell: a 46 x 60 m yard, 5 m walls ----
  box(46.4, 0.4, 60.4, 0, -0.2, 0, 'canvas');
  box(0.4, 5, 60.4, -23.2, 2.5, 0, 'surface');
  box(0.4, 5, 60.4, 23.2, 2.5, 0, 'surface');
  box(46.4, 5, 0.4, 0, 2.5, -30.2, 'surface');
  box(46.4, 5, 0.4, 0, 2.5, 30.2, 'surface');

  // ---- kiln hall (west lane, x ~ -14): a long hall with a furnace block and stacked crates ----
  box(10, 3.4, 14, -15, 1.7, -8, 'surface');        // kiln furnace mass
  box(1.6, 1.4, 1.6, -9, 0.7, -14, 'hairline');     // crate stack
  box(1.6, 1.4, 1.6, -9, 2.1, -14, 'hairline');
  box(1.6, 1.4, 1.6, -11, 0.7, -12, 'hairline');
  box(2.2, 1.2, 3.2, -19, 0.6, 2, 'hairline');      // pallet near spawn
  box(2.2, 1.2, 3.2, -10.5, 0.6, 8, 'hairline');

  // ---- mid yard (centre lane): staggered low cover, a raised mid ledge, chimney ----
  box(3.2, 2.6, 3.2, 0, 1.3, 0, 'surface');         // centre pillar
  box(6, 1.1, 1.4, -3, 0.55, 5, 'hairline');
  box(6, 1.1, 1.4, 3, 0.55, -5, 'hairline');
  box(2.4, 1.1, 2.4, -6, 0.55, -11, 'hairline');
  box(2.4, 1.1, 2.4, 6, 0.55, 11, 'hairline');
  box(1.8, 7.5, 1.8, 0, 3.75, -18, 'surface');      // chimney
  box(8, 0.5, 3, 0, 0.25, 14, 'surface');           // mid platform (low)

  // ---- loading dock (east lane, x ~ +12): dock ledge, containers, bombsite A ----
  box(9, 1.3, 7, 16.5, 0.65, -14, 'surface');       // dock ledge (walk-up ramp west of it)
  box(2.6, 2.6, 6, 12.5, 1.3, -6, 'hairline');      // container 1
  box(2.6, 2.6, 6, 18, 1.3, -4, 'hairline');        // container 2
  box(1.4, 1.1, 5, 8, 0.55, 2, 'hairline');         // site cover low wall
  box(5, 1.1, 1.4, 16, 0.55, 6, 'hairline');        // site cover wall
  box(2.2, 2.2, 2.2, 20.5, 1.1, 10, 'hairline');    // site corner crate
  box(1.4, 1.1, 5, 9.5, 0.55, 14, 'hairline');      // approach cover
  box(2.6, 1.1, 2.6, 12, 0.55, 22, 'hairline');     // back cover
  // ramp up to the dock
  box(3, 0.45, 5, 11.2, 0.22, -14, 'hairline');
  box(3, 0.85, 5, 12.9, 0.42, -14, 'hairline');

  // ---- connector walls that shape the three lanes and doorways ----
  box(1, 3.2, 12, -6.5, 1.6, -2, 'surface');        // kiln/mid divider, gaps north & south
  box(1, 3.2, 12, 6.5, 1.6, 4, 'surface');          // mid/dock divider
  box(7, 3.2, 1, -13, 1.6, 12, 'surface');          // kiln south wall stub
  box(7, 3.2, 1, 13, 1.6, -12, 'surface');          // dock north wall stub

  // ---- site A marker: an ember-lit frame over the plant zone ----
  const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const postG = new THREE.BoxGeometry(0.18, 3.4, 0.18);
  const p1 = new THREE.Mesh(postG, frameMat); p1.position.set(SITE_A.x - 3.4, 1.7, SITE_A.z - 3.4);
  const p2 = new THREE.Mesh(postG, frameMat); p2.position.set(SITE_A.x + 3.4, 1.7, SITE_A.z - 3.4);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.18, 0.18), frameMat);
  beam.position.set(SITE_A.x, 3.4, SITE_A.z - 3.4);
  group.add(p1, p2, beam);

  // ---- bombsite floor decal ----
  const decal = new THREE.Mesh(
    new THREE.CircleGeometry(SITE_A.radius, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.16, depthWrite: false }),
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(SITE_A.x, 0.02, SITE_A.z);
  group.add(decal);

  // ---- lighting: one low dusk key from the west, a cool sky fill, an ember glow at site A ----
  const ambient = new THREE.AmbientLight(new THREE.Color('#3a4250'), 1.4);
  scene.add(ambient);
  const sky = new THREE.HemisphereLight(new THREE.Color('#4a5a70'), new THREE.Color('#20242a'), 2.4);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color('#ffe9c4'), 4.2);
  key.position.set(-14, 16, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 34;
  key.shadow.camera.bottom = -34;
  key.shadow.camera.far = 64;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const siteGlow = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 16, 1.4);
  siteGlow.position.set(SITE_A.x, 2.6, SITE_A.z);
  scene.add(siteGlow);

  const kilnGlow = new THREE.PointLight(new THREE.Color(PALETTE.accent), 40, 14, 1.6);
  kilnGlow.position.set(-15, 2.2, -8);
  scene.add(kilnGlow);

  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 44, 120);

  return { colliders, shootables, group, materials };
}
