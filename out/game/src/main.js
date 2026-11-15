// EMBERLINE — boot, the one fixed-step loop, the player, the bomb, grenades and damage.
// A 5v5 round-based tactical shooter: attack the site, plant, defend; then swap sides at half.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, MAP_BOUNDS, SITE_A, SPAWN_ATTACK, SPAWN_DEFEND } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { WEAPONS, createArsenal, GRENADE_PRICE, GRENADE_DAMAGE, GRENADE_RADIUS } from './weapon.js';
import { createBots } from './bots.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 14)) >>> 0;
    return t / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 3.4;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const match = createMatch();
const hud = createHud(match);
const input = createInput(renderer.domElement, null);
const player = createPlayer(world.colliders);
const arsenal = createArsenal(camera);
const bots = createBots(scene, world, null);
const raycaster = new THREE.Raycaster();
const direction = new THREE.Vector3();

const body = player.state;
let accumulator = 0;
let lastTime = performance.now();
let started = false;
let frozen = false;
let elapsed = 0;

// ---------- squad tallies: the player plus four ember bots against five frost bots ----------
let friendlyAlive = 5;
let enemyAlive = 5;

function apiDamageSoldier(victim, amount, attacker) {
  const killed = bots.damage(victim, amount);
  if (killed) {
    if (victim.team === 'frost') {
      enemyAlive -= 1;
      if (attacker === 'player') match.addKillReward('player');
      hud.feed(`You ▸ ${victim.id}`);
      checkRoundWipe();
    } else {
      friendlyAlive -= 1;
      hud.feed(`${victim.id} ✕`);
      checkRoundWipe();
    }
  }
}

function apiTime() { return elapsed; }
function apiRoundLive() { return match.state.phase === 'live' || match.state.phase === 'planted'; }

function apiBotMission(soldier) {
  const m = match.state;
  if (m.phase === 'buy' || m.phase === 'end') return 'hold';
  const attacking = soldier.team === (match.playerAttacking() ? 'ember' : 'frost');
  if (attacking) {
    if (m.bomb?.planted) return 'hold';
    return 'advance';
  }
  if (m.bomb?.planted) return 'defuse';
  return soldier.routeIndex >= soldier.route.length - 1 ? 'hold' : 'advance';
}

function apiBotPlant(soldier) {
  const m = match.state;
  if (m.bomb?.planted || m.phase !== 'live') return;
  m.bomb.planted = true;
  m.bomb.position = { x: soldier.position.x, z: soldier.position.z };
  m.phase = 'planted';
  match.log('Enemy planted the bomb');
  hud.feed('Bomb planted — defuse it!');
}

function apiBotDefuse() {
  const m = match.state;
  if (!m.bomb?.planted || m.bomb.defuseLeft <= 0) return;
  match.defuseProgressTick(FIXED_STEP, true);
}

const botApi = {
  damageSoldier: apiDamageSoldier,
  time: apiTime,
  roundLive: apiRoundLive,
  botMission: apiBotMission,
  botPlant: apiBotPlant,
  botDefuse: apiBotDefuse,
};

function checkRoundWipe() {
  const m = match.state;
  if (m.phase === 'end' || m.phase === 'buy') return;
  if (!m.playerAlive && friendlyAlive <= 0) match.endRound('enemy', 'attackers eliminated');
  else if (enemyAlive <= 0 && !m.bomb?.planted) match.endRound('player', 'defenders eliminated');
}

// ---------- player damage ----------
function hurtPlayer(amount, source) {
  const m = match.state;
  if (!m.playerAlive || m.phase === 'buy' || m.phase === 'end') return;
  if (window.__debugHp !== false) {
    window.__debugHp = (window.__debugHp ?? 100) - amount;
    console.log('HP', m.playerHealth, '<-', amount, 'from', source ?? 'unknown');
  }
  m.playerHealth = Math.max(0, (m.playerHealth ?? 100) - amount);
  hud.setHealth(m.playerHealth);
  if (m.playerHealth <= 0) {
    m.playerAlive = false;
    friendlyAlive -= 1;
    hud.feed('You were eliminated');
    checkRoundWipe();
    if (m.phase !== 'end' && document.pointerLockElement) document.exitPointerLock();
  }
}

// ---------- frost bots also engage the player ----------
function enemyBotsStep(dt) {
  const m = match.state;
  if (shot) return;                    // captures stay deterministic
  if (!m.playerAlive || m.phase === 'buy' || m.phase === 'end') return;
  const eyePlayer = new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z);
  const playerSpeed = player.groundSpeed();
  for (const soldier of bots.roster) {
    if (!soldier.alive || soldier.team !== 'frost') continue;
    if (soldier.targetId === 'player') continue;
    const eye = new THREE.Vector3(soldier.position.x, soldier.position.y + bots.EYE, soldier.position.z);
    const to = new THREE.Vector3().subVectors(eyePlayer, eye);
    const dist = to.length();
    if (dist > 34) continue;
    to.normalize();
    const facing = new THREE.Vector3(-Math.sin(soldier.yaw), 0, -Math.cos(soldier.yaw));
    if (to.dot(facing) < 0.5) continue;
    if (new THREE.Raycaster(eye, to, 0.1, dist - 0.5).intersectObjects(world.shootables, false).length > 0) continue;
    soldier.fireCd = Math.max(0, soldier.fireCd - dt);
    if (soldier.fireCd === 0) {
      soldier.fireCd = 0.16;
      console.log('FROST SHOOTS PLAYER', soldier.id, 'dist', dist.toFixed(1), 'dot', to.dot(facing).toFixed(2));
      const hitChance = Math.max(0.08, 0.62 - dist * 0.012 - playerSpeed * 0.045);
      if (random() < hitChance) hurtPlayer(18 + Math.floor(random() * 10), `bot ${soldier.id} dist=${dist.toFixed(1)}`);
    }
  }
}

// ---------- grenades ----------
const grenadeMeshes = [];
function throwGrenade() {
  const m = match.state;
  if (m.phase !== 'live' && m.phase !== 'planted') return;
  if (!m.playerAlive) return;
  if (!arsenal.throwGrenade()) return;
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.5, metalness: 0.4 }),
  );
  mesh.position.set(body.position.x, body.position.y + body.eye - 0.1, body.position.z);
  mesh.userData.velocity = new THREE.Vector3(direction.x, direction.y + 0.12, direction.z).multiplyScalar(16);
  mesh.userData.fuse = 1.6;
  scene.add(mesh);
  grenadeMeshes.push(mesh);
  hud.setGrenades(arsenal.grenade.carried);
}

function stepGrenades(dt) {
  for (let index = grenadeMeshes.length - 1; index >= 0; index -= 1) {
    const mesh = grenadeMeshes[index];
    const v = mesh.userData.velocity;
    v.y -= 14 * dt;
    const nx = mesh.position.x + v.x * dt;
    const ny = mesh.position.y + v.y * dt;
    const nz = mesh.position.z + v.z * dt;
    if (nx < -MAP_BOUNDS.x || nx > MAP_BOUNDS.x) v.x *= -0.4;
    else mesh.position.x = nx;
    if (nz < -MAP_BOUNDS.z || nz > MAP_BOUNDS.z) v.z *= -0.4;
    else mesh.position.z = nz;
    if (ny < 0.12) { mesh.position.y = 0.12; v.y *= -0.35; v.x *= 0.7; v.z *= 0.7; }
    else mesh.position.y = ny;
    mesh.userData.fuse -= dt;
    if (mesh.userData.fuse <= 0) {
      const blast = new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z);
      const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 120, GRENADE_RADIUS * 2.4, 2);
      light.position.copy(blast);
      scene.add(light);
      setTimeout(() => scene.remove(light), 120);
      for (const soldier of bots.roster) {
        if (!soldier.alive) continue;
        const d = soldier.position.distanceTo(blast);
        if (d < GRENADE_RADIUS) {
          const dirTo = new THREE.Vector3().subVectors(
            new THREE.Vector3(soldier.position.x, soldier.position.y + 1, soldier.position.z), blast,
          ).normalize();
          const blocked = new THREE.Raycaster(blast, dirTo, 0.1, d).intersectObjects(world.shootables, false).length > 0;
          if (!blocked) apiDamageSoldier(soldier, GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS) + 20, 'player');
        }
      }
      const pd = Math.hypot(body.position.x - blast.x, body.position.z - blast.z);
      if (pd < GRENADE_RADIUS) hurtPlayer(40 * (1 - pd / GRENADE_RADIUS));
      scene.remove(mesh);
      grenadeMeshes.splice(index, 1);
    }
  }
}

// ---------- the bomb ----------
function inSite(position) {
  return Math.hypot(position.x - SITE_A.x, position.z - SITE_A.z) < SITE_A.radius;
}

function playerBombStep(dt) {
  const m = match.state;
  if (!m.playerAlive || !match.playerAttacking() || m.bomb?.planted || m.phase !== 'live') return;
  const holdingE = input.state.keys.has('KeyE');
  if (holdingE && inSite(body.position)) {
    m.plantProgress = Math.min(1, m.plantProgress + dt / 3.2);
    hud.bombProgress('plant', m.plantProgress);
    if (m.plantProgress >= 1) {
      match.plantBomb('player');
      m.phase = 'planted';
      m.bomb.position = { x: body.position.x, z: body.position.z };
      hud.bombProgress(null);
      hud.feed('Bomb planted — defend it!');
      m.money = Math.min(9000, m.money + 300);
      hud.setMoney(m.money);
    }
  } else {
    m.plantProgress = Math.max(0, m.plantProgress - dt * 1.5);
    if (m.plantProgress === 0) hud.bombProgress(null);
  }
}

function playerDefuseStep(dt) {
  const m = match.state;
  if (!m.bomb?.planted || match.playerAttacking() || !m.playerAlive) return;
  const holdingE = input.state.keys.has('KeyE');
  const near = Math.hypot(body.position.x - m.bomb.position.x, body.position.z - m.bomb.position.z) < 2.4;
  match.defuseProgressTick(dt, holdingE && near);
  if (m.defuseProgress > 0) hud.bombProgress('defuse', m.defuseProgress);
  else hud.bombProgress(null);
}

// ---------- shooting ----------
const sparkPool = [];
function spark(point) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 6, 4),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  mesh.position.copy(point);
  scene.add(mesh);
  sparkPool.push({ mesh, life: 0.12 });
}
function stepSparks(dt) {
  for (let index = sparkPool.length - 1; index >= 0; index -= 1) {
    const item = sparkPool[index];
    item.life -= dt;
    if (item.life <= 0) {
      scene.remove(item.mesh);
      sparkPool.splice(index, 1);
    }
  }
}

function shoot() {
  const spec = arsenal.spec;
  if (!arsenal.takeRound()) return;
  camera.getWorldDirection(direction);
  const spread = shot ? 0 : arsenal.spread(player.groundSpeed());
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects([...world.shootables, ...bots.hitMeshes], false)[0];
  if (hit) {
    const soldier = hit.object.userData.soldier;
    if (soldier && soldier.alive && soldier.team !== 'ember') {
      const isHead = hit.object === soldier.head;
      apiDamageSoldier(soldier, isHead ? spec.damageHead : spec.damageTorso, 'player');
      hud.hitMarker(isHead || soldier.health <= 0);
    } else {
      spark(hit.point);
    }
  }
  arsenal.pullTrigger();
  player.recoil(spec.recoil + random() * 0.003, (random() * 2 - 1) * 0.004);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
}

// ---------- round lifecycle ----------
function beginRound() {
  const m = match.state;
  friendlyAlive = 5;
  enemyAlive = 5;
  bots.resetAll();
  bots.spawnAll(match.playerAttacking(), 'player');
  match.startRound();
  const spawnList = match.playerAttacking() ? SPAWN_ATTACK : SPAWN_DEFEND;
  body.position.set(spawnList[0][0], 0, spawnList[0][1]);
  body.velocity.set(0, 0, 0);
  m.playerHealth = 100;
  m.playerAlive = true;
  hud.setHealth(100);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  hud.setMoney(m.money);
  hud.setScore(m.playerScore, m.enemyScore);
  hud.setWeapon(arsenal.kind, arsenal.spec.name);
  hud.setGrenades(arsenal.grenade.carried);
}

function finishBuy() {
  hud.showBuy(false);
  hud.hideOverlay();
  if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
}

function onRoundEnd() {
  const m = match.state;
  hud.setScore(m.playerScore, m.enemyScore);
  if (m.matchOver) {
    hud.showOverlay('match');
    hud.showMatch(m.playerScore, m.enemyScore);
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    hud.showOverlay('end', `${m.winner === 'player' ? 'You take the round.' : 'Enemy takes the round.'} ${m.playerScore}–${m.enemyScore}.`);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

hud.onBuy((kind) => {
  const m = match.state;
  if (kind === 'grenade') {
    if (m.money >= GRENADE_PRICE) {
      m.money -= GRENADE_PRICE;
      arsenal.buyGrenade();
      hud.setMoney(m.money);
      hud.setGrenades(arsenal.grenade.carried);
    }
  } else if (WEAPONS[kind] && m.money >= WEAPONS[kind].price) {
    m.money -= WEAPONS[kind].price;
    arsenal.buyPrimary(kind);
    hud.setMoney(m.money);
    hud.setWeapon(kind, WEAPONS[kind].name);
    hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  }
  hud.showBuy(true, m.money);
});

hud.onPlay(() => {
  const m = match.state;
  hud.hideMatch();
  if (m.matchOver) {
    m.round = 1;
    m.half = 1;
    m.playerScore = 0;
    m.enemyScore = 0;
    m.money = 800;
    m.matchOver = false;
    arsenal.buyPrimary('pistol');
    arsenal.grenade.carried = 0;
    beginRound();
    hud.showOverlay('buy');
    hud.showBuy(true, m.money);
    return;
  }
  if (m.phase === 'buy') {
    finishBuy();
    started = true;
    return;
  }
  beginRound();
  started = true;
});

document.addEventListener('mousedown', (event) => {
  if (shot || frozen || !started) return;
  if (!document.pointerLockElement) return;
  const m = match.state;
  if (m.phase === 'buy' || m.phase === 'end') return;
  if (event.button === 2 && arsenal.grenade.carried > 0) throwGrenade();
  else if (event.button === 0 && arsenal.ready()) {
    shoot();
    if (!arsenal.spec.auto) input.state.firing = false;
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') {
    arsenal.reload();
    hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    if (match.state.phase === 'buy') hud.showBuy(true, match.state.money);
    else hud.hideOverlay();
  } else if (!frozen && started && !match.state.matchOver) {
    hud.showOverlay('paused');
  }
}
document.addEventListener('pointerlockchange', () => onLockChange(!!document.pointerLockElement));

// ---------- simulation ----------
function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function step(dt) {
  elapsed += dt;
  const m = match.state;
  match.step(dt, m);
  player.step(dt, input.state.keys);
  arsenal.step(dt);
  bots.step(dt, world, world.shootables, botApi);
  enemyBotsStep(dt);
  stepGrenades(dt);
  stepSparks(dt);
  if (m.phase === 'live' || m.phase === 'planted') {
    playerBombStep(dt);
    playerDefuseStep(dt);
  } else {
    hud.bombProgress(null);
  }
  const phaseText = m.phase === 'buy' ? 'BUY' : m.bomb?.planted ? 'BOMB' : m.phase === 'end' ? 'ROUND END' : 'LIVE';
  hud.setRound(m.phase === 'buy' ? m.phaseLeft : m.bomb?.planted ? Math.max(0, m.bomb.plantLeft) : m.roundLeft, phaseText);
  if (m.phase === 'end' && !m._endShown) {
    m._endShown = true;
    onRoundEnd();
    hud.showBuy(false);
  }
  if (m.phase !== 'end') m._endShown = false;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    if (input.state.firing && arsenal.ready() && arsenal.spec.auto) shoot();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 10) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 10) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

// ---------- deterministic screenshots ----------
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}
function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}
function runShot(name) {
  beginRound();
  hud.hideOverlay();
  hud.showBuy(false);
  match.state.phase = 'live';
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'play') {
    body.position.set(-2, 0, -10);
    settle(30);
    aimAt(new THREE.Vector3(14, 1.4, 0));
    shoot();
    settle(6);
  } else if (name === 'end') {
    body.position.set(8, 0, -4);
    settle(30);
    match.state.bomb.planted = true;
    match.state.bomb.position = { x: SITE_A.x, z: SITE_A.z };
    match.state.phase = 'planted';
    match.state.bomb.plantLeft = 14;
    aimAt(new THREE.Vector3(16, 1.6, 6));
    hud.bombProgress('defuse', 0.4);
    hud.feed('Bomb planted — defend it!');
  } else {
    body.position.set(-18, 0, -22);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, 8));
    hud.showOverlay('start');
  }
  hud.setScore(match.state.playerScore, match.state.enemyScore);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve);
  hud.setHealth(match.state.playerHealth ?? 100);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100);
hud.setMoney(match.state.money);
hud.setScore(0, 0);
hud.setWeapon('pistol', WEAPONS.pistol.name);
if (shot) runShot(shot);
else {
  beginRound();
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
