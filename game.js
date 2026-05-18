// ===== BOTANICA GAME ENGINE =====

const NUM_POTS = 5;
const DAY_DURATION_MS = 60000; // 1 real minute = 1 game day
const WITHER_DAYS = 2; // days without water before death

// ===== STATE =====
let state = {
  money: 100,
  day: 1,
  timeOfDay: 0, // 0..1 (0=dawn, 0.5=noon, 1=midnight)
  weather: 'sunny', // sunny | cloudy | rainy
  hasWateringCan: false,
  waterCharges: 0,
  seeds: 5,
  fertilizer: 0,
  pots: [],
  darkMode: true,
  dragging: null, // { type, sourceSlot }
  rainSavedToday: false,
};

// ===== PLANT STAGES =====
// 0=empty, 1=seed, 2=sprout, 3=seedling, 4=young, 5=mature, 6=flowering, 7=wilted/dead
const STAGE_NAMES = ['Empty', 'Seed', 'Sprout', 'Seedling', 'Young Plant', 'Mature', 'Flowering', 'Wilted'];
const SELL_VALUES = [0, 0, 0, 2, 5, 12, 20, 0];

// ===== INIT POTS =====
function initPots() {
  state.pots = [];
  for (let i = 0; i < NUM_POTS; i++) {
    state.pots.push({
      id: i,
      stage: 0,
      dayPlanted: null,
      lastWatered: null,
      wateredToday: false,
      growProgress: 0, // 0..1 within stage
    });
  }
}

// ===== DOM REFS =====
const moneyEl = document.getElementById('money-val');
const dayEl = document.getElementById('day-num');
const weatherEl = document.getElementById('weather-val');
const timeEl = document.getElementById('time-val');
const waterEl = document.getElementById('water-val');
const potsArea = document.getElementById('pots-area');
const inventoryEl = document.getElementById('inventory-items');
const notification = document.getElementById('notification');
const dropHint = document.getElementById('drop-hint');
const rainContainer = document.getElementById('rain-container');
const gameWorld = document.getElementById('game-world');
const darkBtn = document.getElementById('darkmode-btn');
const themeIcon = document.getElementById('theme-icon');
const shopModal = document.getElementById('shop-modal');
const sellModal = document.getElementById('sell-modal');
const gameoverModal = document.getElementById('gameover-modal');
const sellDropzone = document.getElementById('sell-dropzone');
const sellMessage = document.getElementById('sell-message');
const shopMessage = document.getElementById('shop-message');

// ===== DRAG GHOST =====
const ghost = document.createElement('div');
ghost.id = 'drag-ghost';
document.body.appendChild(ghost);

// ===== NOTIFICATIONS =====
let notifTimer;
function notify(msg, type = 'success', duration = 3000) {
  notification.textContent = msg;
  notification.className = 'show ' + type;
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => { notification.className = ''; }, duration);
}

// ===== RENDER MONEY =====
function renderHUD() {
  moneyEl.textContent = '$' + state.money.toFixed(2);
  dayEl.textContent = state.day;
  waterEl.textContent = state.hasWateringCan
    ? (state.waterCharges > 0 ? `${state.waterCharges} charge${state.waterCharges !== 1 ? 's' : ''}` : 'Empty')
    : 'No can';

  const hours = Math.floor(state.timeOfDay * 24);
  const mins = Math.floor((state.timeOfDay * 24 * 60) % 60);
  timeEl.textContent = String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');

  weatherEl.textContent = state.weather.charAt(0).toUpperCase() + state.weather.slice(1);

  // sky
  if (state.weather === 'rainy') {
    gameWorld.classList.add('raining');
    rainContainer.classList.add('active');
  } else {
    gameWorld.classList.remove('raining');
    rainContainer.classList.remove('active');
  }
}

// ===== RENDER INVENTORY =====
function renderInventory() {
  inventoryEl.innerHTML = '';
  const items = [
    { key: 'seeds', icon: '&#9728;&#65039;', label: 'Seeds', count: state.seeds, draggable: state.seeds > 0 },
    { key: 'watering_can', icon: '&#128167;', label: 'Water Can', count: state.hasWateringCan ? state.waterCharges : null, draggable: state.hasWateringCan && state.waterCharges > 0 },
    { key: 'fertilizer', icon: '&#128208;', label: 'Fertilizer', count: state.fertilizer, draggable: state.fertilizer > 0 },
  ];

  items.forEach(item => {
    if (!state.hasWateringCan && item.key === 'watering_can') return;
    if (item.count === 0 && item.key === 'fertilizer') return;

    const el = document.createElement('div');
    el.className = 'inv-item';
    el.dataset.type = item.key;
    el.innerHTML = `<span class="inv-icon">${item.icon}</span><span>${item.label}</span>`;
    if (item.count !== null) {
      const badge = document.createElement('span');
      badge.className = 'inv-count';
      badge.textContent = item.count;
      el.appendChild(badge);
    }
    if (item.draggable) {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => onInvDragStart(e, item.key));
      el.addEventListener('dragend', onDragEnd);
    } else {
      el.style.opacity = '0.45';
    }
    inventoryEl.appendChild(el);
  });

  dropHint.style.opacity = (state.seeds > 0 && state.pots.some(p => p.stage === 0)) ? '1' : '0';
}

// ===== PLANT SVG DRAWING =====
function drawPlant(pot, svgEl) {
  svgEl.innerHTML = '';
  const W = 120, H = 160;
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.setAttribute('width', W);
  svgEl.setAttribute('height', H);

  const cx = W / 2;
  const base = H;

  if (pot.stage === 0) return;
  if (pot.stage === 7) { drawDeadPlant(svgEl, cx, base, W, H); return; }

  const isDark = state.darkMode;
  const stemColor = isDark ? '#4a8a3c' : '#2e6a22';
  const leafColor = isDark ? '#5cba6a' : '#3a9a48';
  const leafDark = isDark ? '#3a8a50' : '#28743c';
  const rootColor = isDark ? '#8a6030' : '#a07040';
  const seedColor = isDark ? '#c8a060' : '#b08040';
  const flowerColor = '#e87878';
  const flowerCenter = '#f0e040';

  const s = pot.stage;

  // ---- ROOTS (visible from stage 1+) ----
  if (s >= 1) {
    const rootAlpha = Math.min(1, (s - 1) * 0.4 + 0.2);
    const numRoots = Math.min(s + 1, 5);
    for (let i = 0; i < numRoots; i++) {
      const angle = -160 + (i * (320 / (numRoots - 1 || 1)));
      const len = 16 + i * 6 + s * 3;
      const rad = angle * Math.PI / 180;
      const ex = cx + Math.cos(rad) * len;
      const ey = base + Math.sin(rad) * len * 0.5;
      const cp1x = cx + Math.cos(rad) * len * 0.3 + (Math.random() - 0.5) * 8;
      const cp1y = base + Math.sin(rad) * len * 0.3 + 5;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', `M ${cx},${base} Q ${cp1x},${cp1y} ${ex},${ey}`);
      line.setAttribute('stroke', rootColor);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('fill', 'none');
      line.setAttribute('opacity', rootAlpha);
      svgEl.appendChild(line);
    }
  }

  // ---- SEED (stage 1) ----
  if (s === 1) {
    const seed = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    seed.setAttribute('cx', cx);
    seed.setAttribute('cy', base - 6);
    seed.setAttribute('rx', '7');
    seed.setAttribute('ry', '5');
    seed.setAttribute('fill', seedColor);
    svgEl.appendChild(seed);
    return;
  }

  // ---- STEM HEIGHT by stage ----
  const stemHeights = [0, 0, 18, 38, 65, 90, 110];
  const stemH = stemHeights[Math.min(s, 6)];

  // Stem
  const stemPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const cp = cx + Math.sin(s * 0.8) * 8;
  stemPath.setAttribute('d', `M ${cx},${base} Q ${cp},${base - stemH * 0.5} ${cx},${base - stemH}`);
  stemPath.setAttribute('stroke', stemColor);
  stemPath.setAttribute('stroke-width', Math.max(2, s * 0.8));
  stemPath.setAttribute('fill', 'none');
  stemPath.setAttribute('stroke-linecap', 'round');
  svgEl.appendChild(stemPath);

  const tipY = base - stemH;

  // ---- LEAVES by stage ----
  if (s >= 3) {
    // first pair of leaves
    drawLeaf(svgEl, cx - 2, base - stemH * 0.35, -50, leafColor, leafDark, s >= 4 ? 28 : 20);
    drawLeaf(svgEl, cx + 2, base - stemH * 0.35, 50, leafColor, leafDark, s >= 4 ? 28 : 20);
  }
  if (s >= 4) {
    drawLeaf(svgEl, cx - 2, base - stemH * 0.6, -55, leafColor, leafDark, 24);
    drawLeaf(svgEl, cx + 2, base - stemH * 0.6, 55, leafColor, leafDark, 24);
  }
  if (s >= 5) {
    drawLeaf(svgEl, cx - 2, base - stemH * 0.78, -45, leafColor, leafDark, 30);
    drawLeaf(svgEl, cx + 2, base - stemH * 0.78, 45, leafColor, leafDark, 30);
    // small top leaves
    drawLeaf(svgEl, cx, tipY + 8, -30, leafColor, leafDark, 18);
    drawLeaf(svgEl, cx, tipY + 8, 30, leafColor, leafDark, 18);
  }
  if (s >= 6) {
    // Flower
    const numPetals = 6;
    for (let i = 0; i < numPetals; i++) {
      const ang = (i / numPetals) * Math.PI * 2;
      const px = cx + Math.cos(ang) * 12;
      const py = tipY - 6 + Math.sin(ang) * 10;
      const petal = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      petal.setAttribute('cx', px);
      petal.setAttribute('cy', py);
      petal.setAttribute('rx', '6');
      petal.setAttribute('ry', '9');
      petal.setAttribute('fill', flowerColor);
      petal.setAttribute('opacity', '0.9');
      const rot = (ang * 180 / Math.PI) + 90;
      petal.setAttribute('transform', `rotate(${rot}, ${px}, ${py})`);
      svgEl.appendChild(petal);
    }
    const center = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    center.setAttribute('cx', cx);
    center.setAttribute('cy', tipY - 6);
    center.setAttribute('r', '7');
    center.setAttribute('fill', flowerCenter);
    svgEl.appendChild(center);
  } else if (s >= 2) {
    // bud
    const bud = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    bud.setAttribute('cx', cx);
    bud.setAttribute('cy', tipY - 3);
    bud.setAttribute('rx', s >= 4 ? '5' : '3');
    bud.setAttribute('ry', s >= 4 ? '7' : '5');
    bud.setAttribute('fill', s >= 5 ? '#d06060' : leafColor);
    svgEl.appendChild(bud);
  }
}

function drawLeaf(svgEl, x, y, angle, fill, darkFill, size) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `rotate(${angle}, ${x}, ${y})`);

  const leaf = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  leaf.setAttribute('cx', x + (angle < 0 ? -size * 0.4 : size * 0.4));
  leaf.setAttribute('cy', y - size * 0.2);
  leaf.setAttribute('rx', size * 0.55);
  leaf.setAttribute('ry', size * 0.3);
  leaf.setAttribute('fill', fill);

  const vein = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  vein.setAttribute('x1', x);
  vein.setAttribute('y1', y);
  vein.setAttribute('x2', x + (angle < 0 ? -size * 0.7 : size * 0.7));
  vein.setAttribute('y2', y - size * 0.25);
  vein.setAttribute('stroke', darkFill);
  vein.setAttribute('stroke-width', '0.8');
  vein.setAttribute('opacity', '0.6');

  g.appendChild(leaf);
  g.appendChild(vein);
  svgEl.appendChild(g);
}

function drawDeadPlant(svgEl, cx, base, W, H) {
  const stemH = 50;
  const stem = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  stem.setAttribute('d', `M ${cx},${base} Q ${cx - 10},${base - 25} ${cx - 15},${base - stemH}`);
  stem.setAttribute('stroke', '#6a5030');
  stem.setAttribute('stroke-width', '2');
  stem.setAttribute('fill', 'none');
  stem.setAttribute('opacity', '0.5');
  svgEl.appendChild(stem);

  // drooping leaves
  for (let i = 0; i < 3; i++) {
    const ly = base - stemH * (0.3 + i * 0.25);
    const leaf = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    leaf.setAttribute('d', `M ${cx - 12},${ly} Q ${cx - 5 - i * 3},${ly + 10} ${cx},${ly - 2}`);
    leaf.setAttribute('fill', '#5a4520');
    leaf.setAttribute('opacity', '0.4');
    svgEl.appendChild(leaf);
  }
}

// ===== RENDER POTS =====
function renderPots() {
  potsArea.innerHTML = '';
  state.pots.forEach((pot, i) => {
    const slot = document.createElement('div');
    slot.className = 'pot-slot';
    slot.dataset.potId = i;
    if (pot.stage > 0 && pot.stage < 7 && !pot.wateredToday && state.day - (pot.lastWatered || pot.dayPlanted) >= 1) {
      slot.classList.add('needs-water');
    }

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'plant-canvas-wrap';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('plant-svg');
    svg.id = `plant-svg-${i}`;
    drawPlant(pot, svg);
    canvasWrap.appendChild(svg);

    const waterInd = document.createElement('div');
    waterInd.className = 'water-indicator';
    waterInd.textContent = 'Needs water';
    canvasWrap.appendChild(waterInd);

    const rim = document.createElement('div');
    rim.className = 'pot-rim';
    const body = document.createElement('div');
    body.className = 'pot-body';
    const label = document.createElement('div');
    label.className = 'pot-label';
    label.textContent = pot.stage === 0 ? 'Empty' : STAGE_NAMES[pot.stage];

    slot.appendChild(canvasWrap);
    slot.appendChild(rim);
    slot.appendChild(body);
    slot.appendChild(label);
    potsArea.appendChild(slot);

    // Drag over (to receive seeds/water/fertilizer)
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      slot.classList.add('dragover');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('dragover');
      handleDropOnPot(i);
    });

    // Click to water if watering can equipped
    slot.addEventListener('click', () => handlePotClick(i));

    // Make mature plants draggable (for selling)
    if (pot.stage >= 5) {
      svg.draggable = true;
      svg.style.cursor = 'grab';
      svg.addEventListener('dragstart', (e) => onPlantDragStart(e, i));
      svg.addEventListener('dragend', onDragEnd);
    }
  });
}

// ===== POT CLICK (water) =====
function handlePotClick(potIdx) {
  const pot = state.pots[potIdx];
  if (pot.stage === 0 || pot.stage === 7) return;
  if (!state.hasWateringCan) {
    notify('Buy a watering can from the shop first!', 'warn');
    return;
  }
  if (state.waterCharges <= 0) {
    notify('Watering can is empty! Buy water refill.', 'warn');
    return;
  }
  if (pot.wateredToday) {
    notify('Already watered today.', 'warn');
    return;
  }
  state.waterCharges--;
  pot.wateredToday = true;
  pot.lastWatered = state.day;
  notify('Plant watered!', 'success');
  renderHUD();
  renderInventory();
  renderPots();
}

// ===== DRAG FROM INVENTORY =====
function onInvDragStart(e, type) {
  state.dragging = { type, source: 'inventory' };
  ghost.textContent = type === 'seeds' ? '&#127807;' : type === 'watering_can' ? '&#128167;' : '&#128208;';
  ghost.innerHTML = ghost.textContent;
  ghost.style.display = 'block';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setDragImage(new Image(), 0, 0);
}

function onPlantDragStart(e, potIdx) {
  const pot = state.pots[potIdx];
  if (pot.stage < 5) { notify('Plant not ready to sell yet.', 'warn'); e.preventDefault(); return; }
  state.dragging = { type: 'plant', source: 'pot', potIdx };
  ghost.innerHTML = '&#127807;';
  ghost.style.display = 'block';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setDragImage(new Image(), 0, 0);
}

function onDragEnd() {
  state.dragging = null;
  ghost.style.display = 'none';
}

document.addEventListener('dragover', (e) => {
  ghost.style.left = e.clientX + 'px';
  ghost.style.top = e.clientY + 'px';
});

// ===== DROP ON POT =====
function handleDropOnPot(potIdx) {
  if (!state.dragging) return;
  const pot = state.pots[potIdx];
  const { type } = state.dragging;

  if (type === 'seeds') {
    if (pot.stage !== 0) { notify('Pot is already occupied!', 'warn'); return; }
    if (state.seeds <= 0) { notify('No seeds left!', 'warn'); return; }
    state.seeds--;
    pot.stage = 1;
    pot.dayPlanted = state.day;
    pot.lastWatered = state.day;
    pot.wateredToday = true;
    pot.growProgress = 0;
    notify('Seed planted!', 'success');
    renderHUD(); renderInventory(); renderPots();
    return;
  }

  if (type === 'watering_can') {
    handlePotClick(potIdx);
    return;
  }

  if (type === 'fertilizer') {
    if (pot.stage === 0 || pot.stage === 7) { notify('Nothing to fertilize!', 'warn'); return; }
    if (state.fertilizer <= 0) { notify('No fertilizer!', 'warn'); return; }
    state.fertilizer--;
    if (pot.stage < 6) pot.stage++;
    notify('Fertilizer applied! Plant grew!', 'success');
    renderInventory(); renderPots();
    return;
  }
}

// ===== SELL DROPZONE =====
sellDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (state.dragging?.type === 'plant') sellDropzone.classList.add('dragover');
});
sellDropzone.addEventListener('dragleave', () => sellDropzone.classList.remove('dragover'));
sellDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  sellDropzone.classList.remove('dragover');
  if (!state.dragging || state.dragging.type !== 'plant') {
    sellMessage.textContent = 'Drag a mature plant here to sell!';
    return;
  }
  const { potIdx } = state.dragging;
  const pot = state.pots[potIdx];
  if (pot.stage < 5) { sellMessage.textContent = 'Plant is not mature enough!'; return; }
  const value = SELL_VALUES[pot.stage];
  state.money += value;
  pot.stage = 0;
  pot.dayPlanted = null;
  pot.lastWatered = null;
  pot.wateredToday = false;
  sellMessage.textContent = `Sold for $${value}!`;
  notify(`Sold plant for $${value}!`, 'success');
  renderHUD(); renderPots();
  checkLoseCondition();
});

// ===== SHOP =====
document.getElementById('shop-btn').addEventListener('click', () => {
  shopMessage.textContent = '';
  shopModal.classList.remove('hidden');
});

document.querySelectorAll('.buy-btn[data-item]').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.dataset.item;
    const price = parseFloat(btn.dataset.price);
    if (state.money < price) { shopMessage.textContent = 'Not enough money!'; return; }

    if (item === 'seed_packet') {
      state.money -= price;
      state.seeds += 5;
      shopMessage.textContent = 'Got 5 seeds!';
      notify('Bought seed packet (+5 seeds)', 'success');
    } else if (item === 'watering_can') {
      if (state.hasWateringCan) { shopMessage.textContent = 'You already have a watering can!'; return; }
      state.money -= price;
      state.hasWateringCan = true;
      state.waterCharges = 0;
      shopMessage.textContent = 'Bought watering can! Buy water refills.';
      notify('Got watering can!', 'success');
    } else if (item === 'water_refill') {
      if (!state.hasWateringCan) { shopMessage.textContent = 'Buy a watering can first!'; return; }
      state.money -= price;
      state.waterCharges++;
      shopMessage.textContent = `Water refill added! (${state.waterCharges} charge${state.waterCharges !== 1 ? 's' : ''})`;
      notify('Water refilled!', 'success');
    } else if (item === 'fertilizer') {
      state.money -= price;
      state.fertilizer++;
      shopMessage.textContent = 'Bought fertilizer!';
      notify('Got fertilizer!', 'success');
    }
    renderHUD(); renderInventory();
  });
});

// ===== SELL MODAL =====
document.getElementById('sell-btn').addEventListener('click', () => {
  sellMessage.textContent = '';
  sellModal.classList.remove('hidden');
});

// ===== CLOSE MODALS =====
document.querySelectorAll('.close-btn[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.close).classList.add('hidden');
  });
});

[shopModal, sellModal].forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});

// ===== DARK MODE =====
darkBtn.addEventListener('click', () => {
  state.darkMode = !state.darkMode;
  document.body.classList.toggle('dark', state.darkMode);
  document.body.classList.toggle('light', !state.darkMode);
  themeIcon.innerHTML = state.darkMode ? '&#9790;' : '&#9728;';
});

// ===== RESTART =====
document.getElementById('restart-btn').addEventListener('click', () => {
  gameoverModal.classList.add('hidden');
  startGame();
});

// ===== WEATHER SYSTEM =====
function rollWeather() {
  const roll = Math.random();
  if (roll < 0.15) state.weather = 'rainy';
  else if (roll < 0.40) state.weather = 'cloudy';
  else state.weather = 'sunny';

  if (state.weather === 'rainy') {
    state.rainSavedToday = false;
    createRaindrops();
    notify('Rain is coming! Your plants will be watered!', 'rain', 4000);
    // Rain waters all planted pots for free
    state.pots.forEach(pot => {
      if (pot.stage > 0 && pot.stage < 7 && !pot.wateredToday) {
        pot.wateredToday = true;
        pot.lastWatered = state.day;
      }
    });
  } else {
    clearRain();
  }
}

function createRaindrops() {
  rainContainer.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const drop = document.createElement('div');
    drop.className = 'raindrop';
    drop.style.left = Math.random() * 100 + 'vw';
    drop.style.height = (10 + Math.random() * 15) + 'px';
    drop.style.animationDuration = (0.5 + Math.random() * 0.5) + 's';
    drop.style.animationDelay = Math.random() * 1 + 's';
    drop.style.opacity = 0.4 + Math.random() * 0.5;
    rainContainer.appendChild(drop);
  }
}

function clearRain() {
  rainContainer.innerHTML = '';
}

function createClouds() {
  document.getElementById('cloud-container').innerHTML = '';
  const num = state.weather === 'cloudy' ? 5 : state.weather === 'rainy' ? 8 : 2;
  for (let i = 0; i < num; i++) {
    const cloud = document.createElement('div');
    cloud.className = 'cloud';
    const w = 80 + Math.random() * 120;
    const h = 30 + Math.random() * 25;
    cloud.style.width = w + 'px';
    cloud.style.height = h + 'px';
    cloud.style.top = (5 + Math.random() * 20) + '%';
    cloud.style.animationDuration = (30 + Math.random() * 40) + 's';
    cloud.style.animationDelay = (-Math.random() * 40) + 's';
    cloud.style.opacity = state.weather === 'rainy' ? 0.4 : 0.15;
    document.getElementById('cloud-container').appendChild(cloud);
  }
}

// ===== GROW TICK =====
function growTick() {
  state.pots.forEach((pot, i) => {
    if (pot.stage === 0 || pot.stage === 7) return;
    if (pot.stage >= 6) return; // fully grown

    // check wither
    const daysSinceWater = state.day - (pot.lastWatered ?? pot.dayPlanted);
    if (daysSinceWater >= WITHER_DAYS && !pot.wateredToday && state.weather !== 'rainy') {
      pot.stage = 7;
      notify(`A plant withered and died! (Pot ${i + 1})`, 'error');
      return;
    }

    // grow if watered
    if (pot.wateredToday || state.weather === 'rainy') {
      pot.stage = Math.min(6, pot.stage + 1);
      const svg = document.getElementById(`plant-svg-${i}`);
      if (svg) {
        svg.classList.remove('grow-pop');
        void svg.offsetWidth;
        svg.classList.add('grow-pop');
        setTimeout(() => svg.classList.remove('grow-pop'), 400);
      }
    }
  });
}

// ===== LOSE CONDITION =====
function checkLoseCondition() {
  const hasActivePlants = state.pots.some(p => p.stage > 0 && p.stage < 7);
  if (state.money <= 0 && state.seeds <= 0 && !hasActivePlants) {
    setTimeout(() => {
      document.getElementById('final-days').textContent = state.day;
      gameoverModal.classList.remove('hidden');
    }, 800);
  }
}

// ===== DAY CYCLE =====
let dayTimer;
let dayStartTime = Date.now();

function tickDay() {
  const elapsed = Date.now() - dayStartTime;
  const progress = Math.min(elapsed / DAY_DURATION_MS, 1);
  state.timeOfDay = progress;
  renderHUD();

  if (progress >= 1) {
    advanceDay();
  }
}

function advanceDay() {
  dayStartTime = Date.now();
  state.day++;

  // Reset watered flags
  state.pots.forEach(pot => { pot.wateredToday = false; });

  growTick();
  rollWeather();
  createClouds();
  renderHUD();
  renderPots();
  checkLoseCondition();

  notify(`Day ${state.day} begins`, 'success', 2000);
}

// ===== START GAME =====
function startGame() {
  clearInterval(dayTimer);
  state = {
    money: 100,
    day: 1,
    timeOfDay: 0,
    weather: 'sunny',
    hasWateringCan: false,
    waterCharges: 0,
    seeds: 5,
    fertilizer: 0,
    pots: [],
    darkMode: document.body.classList.contains('dark'),
    dragging: null,
    rainSavedToday: false,
  };

  initPots();
  rollWeather();
  createClouds();
  dayStartTime = Date.now();
  dayTimer = setInterval(tickDay, 200);
  renderHUD();
  renderInventory();
  renderPots();
}

// ===== BOOT =====
startGame();
