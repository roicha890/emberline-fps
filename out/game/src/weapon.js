// Weapons: three loadout guns + a grenade. Each weapon owns its damage profile, spread
// model, fire rate, magazine and price; the buy menu reads WEAPONS. main.js owns the ray.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'Slate 9',      // sidearm, free, accurate, weak
    price: 0,
    mag: 12,
    reserve: 48,
    fireGap: 0.16,
    reloadTime: 1.4,
    spreadStill: 0.004,
    spreadMoving: 0.02,
    moveRef: 5.2,
    damageTorso: 22,
    damageHead: 90,
    recoil: 0.011,
    auto: false,
    kick: 0.05,
  },
  rifle: {
    name: 'Vesper AR',    // the workhorse rifle
    price: 2700,
    mag: 30,
    reserve: 90,
    fireGap: 0.098,
    reloadTime: 1.9,
    spreadStill: 0.0024,
    spreadMoving: 0.03,
    moveRef: 5.2,
    damageTorso: 33,
    damageHead: 110,
    recoil: 0.0105,
    auto: true,
    kick: 0.055,
  },
  smg: {
    name: 'Kestrel SMG',  // cheap, fast, weaker per shot
    price: 1400,
    mag: 26,
    reserve: 78,
    fireGap: 0.07,
    reloadTime: 1.7,
    spreadStill: 0.005,
    spreadMoving: 0.024,
    moveRef: 5.2,
    damageTorso: 24,
    damageHead: 78,
    recoil: 0.007,
    auto: true,
    kick: 0.04,
  },
  sniper: {
    name: 'Longshore DMR', // one heavy shot, punishes whiffs
    price: 3800,
    mag: 6,
    reserve: 18,
    fireGap: 0.75,
    reloadTime: 2.4,
    spreadStill: 0.0008,
    spreadMoving: 0.06,
    moveRef: 4.2,
    damageTorso: 85,
    damageHead: 200,
    recoil: 0.03,
    auto: false,
    kick: 0.14,
  },
};

export const GRENADE_PRICE = 300;
export const GRENADE_DAMAGE = 88;
export const GRENADE_RADIUS = 5.5;

// A view model built from boxes, re-shaped per weapon kind.
export function createViewModel(camera, kind) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const model = new THREE.Group();

  if (kind === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.26), body);
    const gripM = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), grip);
    gripM.position.set(0, -0.09, 0.08);
    gripM.rotation.x = 0.2;
    model.add(slide, gripM);
    model.position.set(0.22, -0.2, -0.36);
  } else if (kind === 'sniper') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.7), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), grip);
    barrel.position.set(0, 0.02, -0.58);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), grip);
    scope.position.set(0, 0.09, -0.1);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.3), grip);
    stock.position.set(0, -0.02, 0.42);
    model.add(receiver, barrel, scope, stock);
    model.position.set(0.24, -0.2, -0.4);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, kind === 'smg' ? 0.24 : 0.4), grip);
    barrel.position.set(0, 0.025, -(kind === 'smg' ? 0.28 : 0.38));
    const magM = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.07), grip);
    magM.position.set(0, -0.12, 0.02);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), grip);
    stock.position.set(0, -0.02, 0.28);
    model.add(receiver, barrel, magM, stock);
    model.position.set(0.24, -0.2, -0.42);
  }
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, model.position.z - (kind === 'sniper' ? 1.1 : 0.95));
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  return { model, flash, flashLight };
}

// The player's arsenal: one primary + pistol + grenade. Owns ammo and reload state per gun.
export function createArsenal(camera) {
  let primaryKind = 'pistol';
  let gun = null;
  let flash, flashLight;
  let state = null;
  const grenade = { carried: 0 };

  function equip(kind, refill = true) {
    if (gun) camera.remove(gun);
    const vm = createViewModel(camera, kind);
    gun = vm.model; flash = vm.flash; flashLight = vm.flashLight;
    const spec = WEAPONS[kind];
    state = refill
      ? { mag: spec.mag, reserve: spec.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 }
      : state;
    if (refill) state = { mag: spec.mag, reserve: spec.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };
    primaryKind = kind;
  }
  equip('pistol');

  function step(dt) {
    const spec = WEAPONS[primaryKind];
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    gun.position.z = spec === WEAPONS.sniper ? -0.4 + state.kick : gun.userData.z0 ?? gun.position.z;
    gun.position.z = (gun.userData.z0 ??= gun.position.z) + state.kick;
    gun.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      gun.rotation.x = -0.55 * Math.min(1, (spec.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = spec.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    get kind() { return primaryKind; },
    get spec() { return WEAPONS[primaryKind]; },
    get state() { return state; },
    get grenade() { return grenade; },
    equip,
    step,
    ready() { return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0; },
    pullTrigger() {
      const spec = WEAPONS[primaryKind];
      state.cooldown = spec.fireGap;
      state.flash = 0.06;
      state.kick = spec.kick;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const spec = WEAPONS[primaryKind];
      if (state.reloadLeft > 0 || state.mag === spec.mag || state.reserve === 0) return;
      state.reloadLeft = spec.reloadTime;
    },
    spread(speed) {
      const spec = WEAPONS[primaryKind];
      return spec.spreadStill + Math.min(1, speed / spec.moveRef) * spec.spreadMoving;
    },
    throwGrenade() {
      if (grenade.carried <= 0) return false;
      grenade.carried -= 1;
      return true;
    },
    buyPrimary(kind) {
      equip(kind, true);
    },
    buyGrenade() { grenade.carried = Math.min(2, grenade.carried + 1); },
  };
}
