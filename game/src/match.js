// The match: rounds, sides, money, the bomb, buy rules and win conditions. One place owns
// all of it; main.js and hud.js read from here and never duplicate the numbers.
import { SITE_A } from './world.js';

const ROUND_TIME = 100;        // seconds per round
const BOMB_TIME = 38;          // fuse
const PLANT_TIME = 3.2;        // hold to plant
const DEFUSE_TIME = 6.5;       // hold to defuse
const WIN_SCORE = 8;           // first to 8 rounds wins the match
const START_MONEY = 800;
const MAX_MONEY = 9000;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1400;
const LOSS_STREAK_BONUS = 500;

export function createMatch() {
  const match = {
    round: 1,
    half: 1,                    // 1 = player attacks, 2 = player defends
    playerScore: 0,
    enemyScore: 0,
    money: START_MONEY,
    phase: 'buy',               // buy | live | planted | end
    phaseLeft: 8,               // buy-time countdown, then round timer
    roundLeft: ROUND_TIME,
    bomb: null,                 // {carrier, planted, plantedAt, site, defuser, plantLeft, defuseLeft, position}
    winner: null,               // 'player' | 'enemy'
    lossStreak: { player: 0, enemy: 0 },
    matchOver: false,
    playerAlive: true,
    plantProgress: 0,
    defuseProgress: 0,
  };

  const events = [];

  function log(text) {
    events.push({ round: match.round, text });
    if (events.length > 8) events.shift();
  }

  function playerAttacking() { return match.half === 1; }

  function startRound(aliveEnemies, aliveFriends) {
    match.phase = 'buy';
    match.phaseLeft = 8;
    match.roundLeft = ROUND_TIME;
    match.bomb = { carrier: 'player', planted: false, plantedAt: 0, defuser: null, plantLeft: PLANT_TIME, defuseLeft: DEFUSE_TIME, position: null, carrierId: 'player' };
    match.winner = null;
    match.playerAlive = true;
    match.plantProgress = 0;
    match.defuseProgress = 0;
    log(`Round ${match.round} — buy phase`);
  }

  function endRound(winner, reason) {
    if (match.phase === 'end') return;
    match.phase = 'end';
    match.winner = winner;
    match.phaseLeft = 4.5;
    if (winner === 'player') {
      match.playerScore += 1;
      match.lossStreak.player = 0;
      match.lossStreak.enemy += 1;
      match.money = Math.min(MAX_MONEY, match.money + WIN_REWARD);
    } else {
      match.enemyScore += 1;
      match.lossStreak.enemy = 0;
      match.lossStreak.player += 1;
      const bonus = LOSS_STREAK_BONUS * (match.lossStreak.player - 1);
      match.money = Math.min(MAX_MONEY, match.money + LOSS_REWARD + bonus);
    }
    log(`${winner === 'player' ? 'You win' : 'Enemy wins'} — ${reason}`);
    if (match.playerScore >= WIN_SCORE || match.enemyScore >= WIN_SCORE) {
      match.matchOver = true;
    }
  }

  function advancePhase() {
    if (match.phase === 'end') {
      if (match.matchOver) return;
      match.round += 1;
      // sides flip after round 8 (half time)
      if (match.playerScore + match.enemyScore === 8 && match.half === 1) {
        match.half = 2;
        match.money = Math.max(START_MONEY, Math.floor(match.money * 0.6));
        log('Half time — sides swap, you now defend');
      }
      startRound();
      return;
    }
    if (match.phase === 'buy') {
      match.phase = 'live';
      log('Round live');
      return;
    }
    if (match.phase === 'live') {
      if (match.roundLeft <= 0) {
        // time out: defenders win unless the bomb is planted
        if (match.bomb?.planted) return;
        endRound(playerAttacking() ? 'enemy' : 'player', 'time');
      }
    }
  }

  function step(dt, state) {
    if (match.phase === 'buy') {
      match.phaseLeft -= dt;
      if (match.phaseLeft <= 0) advancePhase();
      return;
    }
    if (match.phase === 'end') {
      match.phaseLeft -= dt;
      if (match.phaseLeft <= 0) advancePhase();
      return;
    }
    if (match.bomb?.planted) {
      match.phase = 'planted';
      match.bomb.plantedAt += dt;
      if (match.bomb.defuseLeft > 0) {
        match.bomb.plantLeft -= dt;
        if (match.bomb.plantLeft <= 0) {
          endRound(playerAttacking() ? 'player' : 'enemy', 'bomb detonated');
        }
      } else {
        match.bomb.plantLeft -= dt;
      }
      // countdown only matters while nobody is defusing
      return;
    }
    match.roundLeft -= dt;
    if (match.roundLeft <= 0) advancePhase();
  }

  function plantBomb(who) {
    if (match.bomb.planted || !playerAttacking() || match.phase !== 'live') return false;
    match.bomb.planted = true;
    match.bomb.plantedAt = 0;
    match.bomb.position = new (SITE_A.x.constructor === Number ? Object : Object)();
    match.bomb.position = { x: SITE_A.x, z: SITE_A.z };
    log('Bomb planted');
    return true;
  }

  function defuseProgressTick(dt, active) {
    if (!match.bomb?.planted || match.bomb.defuseLeft <= 0) return;
    if (active) {
      match.defuseProgress = Math.min(1, match.defuseProgress + dt / DEFUSE_TIME);
      match.bomb.defuseLeft -= dt;
      if (match.bomb.defuseLeft <= 0) {
        endRound(playerAttacking() ? 'enemy' : 'player', 'bomb defused');
      }
    } else {
      match.defuseProgress = Math.max(0, match.defuseProgress - dt * 1.5);
    }
  }

  return {
    state: match,
    step,
    log,
    events,
    playerAttacking,
    startRound,
    endRound,
    plantBomb,
    defuseProgressTick,
    addKillReward(target = 'player') {
      if (target === 'player') match.money = Math.min(MAX_MONEY, match.money + KILL_REWARD);
    },
    constants: { ROUND_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME, WIN_SCORE, START_MONEY, MAX_MONEY, KILL_REWARD, WIN_REWARD, LOSS_REWARD, LOSS_STREAK_BONUS },
  };
}
