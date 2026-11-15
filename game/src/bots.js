// Bots: capsule soldiers with a team, a health pool, a waypoint route and a state machine
// (advance, hold, engage, plant, defuse). Simulation only — no rendering — the same fixed
// step the player uses. Movement reuses the same collide-and-slide rules as the player.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP_BOUNDS, SITE_A } from './world.js';

const HEALTH = 100;
const BOT_WALK = 4.6;
const BOT_CROUCH = 2.2;
const RADIUS = 0.34;
const HEIGHT = 1.72;
const EYE = 1.55;
const ENGAGE_RANGE = 34;
const FIRE_GAP = 0.14;
const ACCURACY = 0.055;      // radians of aim error; bullets use the same raycast the player does
const REACTION = 0.28;       // seconds before the first shot after acquiring
const VIEW_DOT = 0.55;       // ~56 degrees half-angle cone of awareness
const FOV_HEARING = 18;      // shots closer than this are heard

const TEAM_COLORS = {
  ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6, metalness: 0.05 }),
  frost: new THREE.MeshStandardMaterial({ color: new THREE.Color('#6fa8dc'), roughness: 0.6, metalness: 0.05 }),
  dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.65, metalness: 0.05 }),
};

function collide(world, x, y, z) {
  const probe = new THREE.Box3(
    new THREE.Vector3(x - RADIUS, y + 0.02, z - RADIUS),
    new THREE.Vector3(x + RADIUS, y + HEIGHT - 0.02, z + RADIUS),
  );
  for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
  return false;
}

export function createBots(scene, world, onEvent) {
  const roster = [];   // all bots, both teams
  const hitMeshes = [];

  function makeSoldier(team, index, spawn) {
    const group = new THREE.Group();
    const bodyMat = team === 'ember' ? TEAM_COLORS.ember : TEAM_COLORS.frost;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.3), bodyMat);
    torso.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), TEAM_COLORS.dark);
    head.position.y = 1.56;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.28), TEAM_COLORS.dark);
    legs.position.y = 0.36;
    group.add(torso, head, legs);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    group.position.set(spawn[0], 0, spawn[1]);
    scene.add(group);

    const soldier = {
      id: `${team}-${index}`,
      team,
      group,
      torso, head,
      position: new THREE.Vector3(spawn[0], 0, spawn[1]),
      yaw: 0,
      health: HEALTH,
      alive: true,
      mode: 'advance',
      targetId: null,
      fireCd: 0,
      reactLeft: 0,
      routeIndex: 0,
      repathAt: 0,
      holdUntil: 0,
      respawnAt: 0,
      deaths: 0,
      kills: 0,
    };
    torso.userData.soldier = soldier;
    head.userData.soldier = soldier;
    hitMeshes.push(torso, head);
    roster.push(soldier);
    return soldier;
  }

  // Routes: attack side pushes through lanes to site A; defend side holds positions near site.
  const ATTACK_ROUTES = [
    [[-14, -20], [-14, -6], [-12, 4], [8, 2], [SITE_A.x - 1, SITE_A.z + 1]],
    [[-9, -22], [-4, -12], [0, -6], [6, 0], [SITE_A.x - 2, SITE_A.z - 2]],
    [[-18, -18], [-18, 0], [-10, 10], [2, 14], [10, 12], [SITE_A.x - 1, SITE_A.z + 2]],
    [[-6, -24], [2, -16], [8, -8], [12, -2], [SITE_A.x + 1, SITE_A.z - 1]],
    [[-12, -24], [-2, -20], [4, -12], [10, -4], [SITE_A.x, SITE_A.z + 2]],
  ];
  const DEFEND_ROUTES = [
    [[16, 4], [16, 0], [14, -2]],
    [[12, 8], [13, 2], [12, -2]],
    [[20, 6], [18, 2], [16, 0]],
    [[8, 10], [10, 4], [12, 1]],
    [[16, 12], [17, 6], [15, 2]],
  ];

  function spawnAll(attacking, bombCarrierId) {
    // attacking = the player team's side for this round: ember attacks when true.
    const attack = Boolean(attacking);
    const routes = attack ? ATTACK_ROUTES : DEFEND_ROUTES;
    for (let index = 0; index < 4; index += 1) {
      const soldier = makeSoldier('ember', index + 1, attack
        ? [[-18, -24], [-15, -26], [-20, -22], [-13, -23]][index]
        : [[-18, 24], [-15, 26], [-20, 22], [-13, 23]][index]);
      soldier.route = routes[index + 1].map(([x, z]) => new THREE.Vector3(x, 0, z));
      soldier.mode = 'advance';
      soldier.holdUntil = 1.5;
      soldier.group.visible = true;
    }
    for (let index = 0; index < 5; index += 1) {
      const soldier = makeSoldier('frost', index + 1, attack
        ? [[18, 24], [15, 26], [20, 22], [13, 23], [17, 27]][index]
        : [[18, -24], [15, -26], [20, -22], [13, -23], [17, -27]][index]);
      soldier.route = (attack ? DEFEND_ROUTES : ATTACK_ROUTES)[index].map(([x, z]) => new THREE.Vector3(x, 0, z));
      soldier.mode = attack ? 'hold' : 'advance';
      soldier.holdUntil = 1.5 + index * 0.2;
      soldier.group.visible = true;
    }
  }

  function enemyOf(soldier) {
    return roster.filter((s) => s.alive && s.team !== soldier.team);
  }

  function canSee(from, to, world) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist > ENGAGE_RANGE) return false;
    dir.normalize();
    const ray = new THREE.Raycaster(from, dir, 0.1, dist - 0.4);
    return ray.intersectObjects(world.shootables, false).length === 0;
  }

  function acquire(soldier, world) {
    const eye = new THREE.Vector3(soldier.position.x, soldier.position.y + EYE, soldier.position.z);
    let best = null;
    let bestDist = Infinity;
    for (const enemy of enemyOf(soldier)) {
      const enemyEye = new THREE.Vector3(enemy.position.x, enemy.position.y + 1.3, enemy.position.z);
      const toEnemy = new THREE.Vector3().subVectors(enemyEye, eye);
      const dist = toEnemy.length();
      toEnemy.normalize();
      const facing = new THREE.Vector3(-Math.sin(soldier.yaw), 0, -Math.cos(soldier.yaw));
      if (toEnemy.dot(facing) < VIEW_DOT && dist > FOV_HEARING) continue;
      if (dist < bestDist && canSee(eye, enemyEye, world)) {
        best = enemy;
        bestDist = dist;
      }
    }
    return best;
  }

  function moveToward(soldier, point, dt, crouch = false) {
    const dx = point.x - soldier.position.x;
    const dz = point.z - soldier.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) return true;
    const speed = (crouch ? BOT_CROUCH : BOT_WALK) * dt;
    const nx = soldier.position.x + (dx / dist) * speed;
    const nz = soldier.position.z + (dz / dist) * speed;
    if (!collide(world, nx, soldier.position.y, nz)) {
      soldier.position.x = nx;
      soldier.position.z = nz;
    } else if (!collide(world, soldier.position.x, soldier.position.y, nz)) {
      soldier.position.z = nz;
    } else if (!collide(world, nx, soldier.position.y, soldier.position.z)) {
      soldier.position.x = nx;
    } else {
      // slide sideways around cover: pick the freer axis sign
      const side = ((soldier.id.charCodeAt(0) + soldier.routeIndex) % 2) * 2 - 1;
      const sx = soldier.position.x + (-dz / dist) * speed * side;
      const sz = soldier.position.z + (dx / dist) * speed * side;
      if (!collide(world, sx, soldier.position.y, sz)) {
        soldier.position.x = sx;
        soldier.position.z = sz;
      }
    }
    soldier.yaw = Math.atan2(-dx, -dz);
    return false;
  }

  function shoot(soldier, target, world, shootables, api) {
    const eye = new THREE.Vector3(soldier.position.x, soldier.position.y + EYE, soldier.position.z);
    const aim = new THREE.Vector3(target.position.x, target.position.y + 1.25, target.position.z);
    const dir = new THREE.Vector3().subVectors(aim, eye).normalize();
    dir.x += (Math.random() * 2 - 1) * ACCURACY;
    dir.y += (Math.random() * 2 - 1) * ACCURACY;
    dir.z += (Math.random() * 2 - 1) * ACCURACY;
    dir.normalize();
    scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(eye, dir, 0.1, ENGAGE_RANGE);
    const hit = ray.intersectObjects([...shootables, ...hitMeshes], false)[0];
    if (hit) {
      const victim = hit.object.userData.soldier;
      if (victim && victim.team !== soldier.team) {
        const damage = hit.object.userData.soldier && hit.object === victim.head ? 95 : 26;
        api.damageSoldier(victim, damage, soldier);
      }
    }
  }

  function step(dt, world, shootables, api) {
    for (const soldier of roster) {
      if (!soldier.alive) {
        if (api.roundLive() && api.time() >= soldier.respawnAt) {
          // bots do not respawn mid-round in this mode; keep them down
        }
        continue;
      }
      soldier.group.position.set(soldier.position.x, soldier.position.y, soldier.position.z);
      soldier.group.rotation.y = soldier.yaw;
      soldier.fireCd = Math.max(0, soldier.fireCd - dt);

      const target = acquire(soldier, world);
      if (target) {
        soldier.targetId = target.id;
        soldier.reactLeft = soldier.reactLeft || REACTION;
        soldier.reactLeft -= dt;
        soldier.yaw = Math.atan2(
          -(target.position.x - soldier.position.x),
          -(target.position.z - soldier.position.z),
        );
        if (soldier.reactLeft <= 0 && soldier.fireCd === 0) {
          shoot(soldier, target, world, shootables, api);
          soldier.fireCd = FIRE_GAP;
        }
        continue;
      }
      soldier.reactLeft = 0;
      soldier.targetId = null;

      const mission = api.botMission(soldier);
      if (mission === 'hold') {
        if (api.time() < soldier.holdUntil) continue;
        if (api.time() >= soldier.holdUntil && soldier.mode === 'hold') {
          soldier.holdUntil = api.time() + 2 + Math.random() * 2;
          soldier.mode = 'patrol';
        }
        if (soldier.mode === 'patrol') {
          const done = moveToward(soldier, soldier.route[Math.min(soldier.routeIndex, soldier.route.length - 1)], dt, true);
          if (done && soldier.routeIndex < soldier.route.length - 1) soldier.routeIndex += 1;
          else soldier.mode = 'hold';
        }
        continue;
      }

      // advance along route; hold briefly at each waypoint like taking an angle
      if (api.time() < soldier.holdUntil) continue;
      const wp = soldier.route[Math.min(soldier.routeIndex, soldier.route.length - 1)];
      const arrived = moveToward(soldier, wp, dt);
      if (arrived) {
        if (soldier.routeIndex < soldier.route.length - 1) {
          if (api.time() >= soldier.repathAt) {
            soldier.routeIndex += 1;
            soldier.repathAt = api.time() + (Math.random() < 0.3 ? 1.2 : 0);
          }
        }
        if (mission === 'plant') {
          if (api.botPlant(soldier)) continue;
        } else if (mission === 'defuse') {
          api.botDefuse(soldier);
        }
      }
    }
  }

  function damage(soldier, amount) {
    if (!soldier.alive) return false;
    soldier.health -= amount;
    if (soldier.health <= 0) {
      soldier.alive = false;
      soldier.deaths += 1;
      soldier.group.visible = false;
      return true;
    }
    return false;
  }

  function resetAll() {
    for (const soldier of roster) {
      scene.remove(soldier.group);
    }
    roster.length = 0;
    hitMeshes.length = 0;
  }

  return { spawnAll, step, damage, roster, hitMeshes, resetAll, makeSoldier, TEAM_COLORS, EYE, HEIGHT, RADIUS, HEALTH };
}
