// The HUD: crosshair, health, ammo, round timer, score, money, buy menu, kill feed,
// bomb progress and overlays. DOM only, pointer-events only on the buy menu.
const COPY = {
  start: { title: 'EMBERLINE', copy: 'Kiln Yard — 5v5 bomb defusal. You attack in the first half: take Site A, plant, defend the detonation.', action: 'Enter the yard' },
  paused: { title: 'Paused', copy: 'Click to resume.', action: 'Resume' },
  buy: { title: 'Buy phase', copy: 'Pick a loadout, then the round starts.', action: 'Ready (or wait for the timer)' },
  end: { title: 'Round over', copy: '', action: 'Next round' },
  match: { title: 'Match over', copy: '', action: 'Play again' },
};

export function createHud(match) {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const health = document.getElementById('health-value');
  const healthBar = document.getElementById('health-bar');
  const roundTimer = document.getElementById('round-timer');
  const scorePlayer = document.getElementById('score-player');
  const scoreEnemy = document.getElementById('score-enemy');
  const money = document.getElementById('money');
  const phase = document.getElementById('phase');
  const killfeed = document.getElementById('killfeed');
  const weaponName = document.getElementById('weapon-name');
  const grenadeCount = document.getElementById('grenade-count');
  const bombBar = document.getElementById('bomb-bar');
  const bombLabel = document.getElementById('bomb-label');
  const buyMenu = document.getElementById('buy');
  const buyList = document.getElementById('buy-list');
  const matchResult = document.getElementById('match-result');
  let lastFeed = '';

  const items = [
    { kind: 'smg', price: 1400 },
    { kind: 'rifle', price: 2700 },
    { kind: 'sniper', price: 3800 },
    { kind: 'grenade', price: 300 },
  ];

  function renderBuy(moneyNow) {
    buyList.innerHTML = '';
    for (const item of items) {
      const afford = moneyNow >= item.price;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row' + (afford ? '' : ' locked');
      row.innerHTML = `<span>${item.kind === 'grenade' ? 'Frag grenade' : item.kind.toUpperCase()}</span><b>$${item.price}</b>`;
      row.addEventListener('click', () => {
        if (moneyNow < item.price) return;
        buyList.dispatchEvent(new CustomEvent('buy', { detail: item.kind }));
      });
      buyList.appendChild(row);
    }
  }

  function showBuy(show, moneyNow) {
    buyMenu.hidden = !show;
    if (show) renderBuy(moneyNow);
  }

  return {
    showBuy,
    onBuy(handler) { buyList.addEventListener('buy', (e) => handler(e.detail)); },
    onPlay(handler) { play.addEventListener('click', handler); },
    setWeapon(kind, name) { weaponName.textContent = name; },
    setGrenades(count) { grenadeCount.textContent = count > 0 ? `× ${count}` : ''; },
    setAmmo(mag, reserve) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      document.getElementById('ammo').classList.toggle('empty', mag === 0);
    },
    setHealth(value) {
      if (value < 100) console.log('setHealth', value, new Error().stack.split('\n')[2]);
      health.textContent = String(Math.max(0, Math.round(value)));
      healthBar.style.width = `${Math.max(0, value)}%`;
      document.getElementById('health').classList.toggle('low', value < 35);
    },
    setRound(left, phaseText) {
      const s = Math.max(0, Math.ceil(left));
      roundTimer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      phase.textContent = phaseText;
    },
    setScore(player, enemy) {
      scorePlayer.textContent = String(player);
      scoreEnemy.textContent = String(enemy);
    },
    setMoney(value) { money.textContent = `$${value}`; },
    feed(text) {
      if (text === lastFeed) return;
      lastFeed = text;
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.textContent = text;
      killfeed.appendChild(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.firstChild);
      setTimeout(() => row.remove(), 6000);
    },
    bombProgress(kind, value) {
      bombBar.hidden = !kind;
      if (!kind) return;
      bombLabel.textContent = kind === 'plant' ? 'PLANTING…' : 'DEFUSING…';
      bombBar.style.setProperty('--p', `${Math.round(value * 100)}%`);
    },
    showOverlay(mode, scoreLine, matchLine) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'end' ? (scoreLine || text.copy) : mode === 'match' ? (matchLine || '') : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    showMatch(player, enemy) {
      matchResult.hidden = false;
      matchResult.innerHTML = player > enemy
        ? `<b>Victory</b> ${player}–${enemy} — the yard is yours.`
        : `<b>Defeat</b> ${player}–${enemy} — regroup and run it back.`;
    },
    hideMatch() { matchResult.hidden = true; },
  };
}
