/* ============================================================
   Sunnydale Grid — game logic
   Real-time grid management. Client-side only.
   All times in real seconds; a game day = dayLength seconds.
   ============================================================ */

'use strict';

// ---------------- Config ----------------
const SAVE_KEY = 'sunnydale-save-v1';
const BEST_KEY = 'sunnydale-best-v1';

const SETTINGS = {
  dayLength: 8,          // real seconds per game day at 1x
  daysPerSeason: 7,
  startMoney: 480,
  revenuePerMWday: 2.8,  // $ per MW delivered per quoted "unit-day"… see revenue calc
  maintenancePerPlant: 1.6,   // $ per plant per day
  batteryMaintenance: 0.8,
  stressGrowPerSec: 10,  // stress gained per fraction-unmet per second
  stressDecayPerSec: 2.5,
  bankruptLimit: -1,     // any negative balance ends the run
  disasterBaseChance: 0.10,
  disasterChancePerSeason: 0.03,
  disasterMaxChance: 0.38,
};

const PLANTS = {
  solar:   { name: 'Solar Farm',     icon: '☀️',  color: '#ffe066', cost: 80,  cap: 18,  tagline: 'Free sunshine — gone at night' },
  wind:    { name: 'Wind Turbine',   icon: '🌬',  color: '#bde0fe', cost: 55,  cap: 14,  tagline: 'Output swings with the weather' },
  gas:     { name: 'Gas Turbine',    icon: '🔥',  color: '#ffd6a5', cost: 90,  cap: 25,  tagline: 'Always on, quick, mid-sized' },
  coal:    { name: 'Coal Plant',     icon: '🏭',  color: '#d8d5e0', cost: 150, cap: 42,  tagline: 'Big and steady' },
  nuclear: { name: 'Nuclear Reactor',icon: '⚛️',  color: '#e2c8f5', cost: 420, cap: 100, tagline: 'Massive and constant, very pricey' },
  hydro:   { name: 'Hydro Dam',      icon: '💧',  color: '#90e0ef', cost: 260, cap: 60,  tagline: 'Steady, but hurts in droughts and floods' },
  battery: { name: 'Battery Bank',   icon: '🔋',  color: '#b5e48c', cost: 60,  cap: null, storage: 250, chargeRate: 40, dischargeRate: 55, tagline: 'Stores surplus, covers deficits' },
};
const PLANT_ORDER = ['solar', 'wind', 'gas', 'coal', 'nuclear', 'hydro', 'battery'];

const SEASONS = [
  { name: '🌱 Spring',  demand: 1.00, solar: 1.00, wind: 1.00, sky: ['#a8e0d6', '#fff3d6'], ground: '#b7e2a8' },
  { name: '☀️ Summer',  demand: 1.25, solar: 1.15, wind: 0.90, sky: ['#8fd3ff', '#fff2b8'], ground: '#a9dd6f' },
  { name: '🍂 Autumn',  demand: 1.10, solar: 0.85, wind: 1.10, sky: ['#ffc78f', '#ffe8c9'], ground: '#e8b871' },
  { name: '❄️ Winter',  demand: 1.35, solar: 0.70, wind: 1.25, sky: ['#cfe2f5', '#eef6ff'], ground: '#e4edf6' },
];

const DISASTERS = [
  { key: 'storm',    name: '⛈ Storm',        desc: 'Wind cut to 35% for 2 days, solar at 55% for 1 day', days: 2,
    effect: { wind: 0.35, solar: 0.55 } },
  { key: 'heatwave', name: '🔥 Heatwave',     desc: 'Demand up 40% for 3 days', days: 3,
    effect: { demand: 1.40 } },
  { key: 'coldsnap', name: '❄️ Cold Snap',    desc: 'Demand up 45% for 3 days', days: 3,
    effect: { demand: 1.45 } },
  { key: 'drought',  name: '🌵 Drought',      desc: 'Hydro output cut to 40% for 4 days', days: 4,
    effect: { hydro: 0.40 } },
  { key: 'flood',    name: '🌊 Flood',        desc: 'Hydro output cut to 20% for 3 days', days: 3,
    effect: { hydro: 0.20 } },
  { key: 'calm',     name: '🍃 Wind Calm',    desc: 'Wind cut to 30% for 2 days', days: 2,
    effect: { wind: 0.30 } },
  { key: 'eclipse',  name: '🌑 Solar Eclipse',desc: 'Solar cut to 25% for 1 day', days: 1,
    effect: { solar: 0.25 } },
];

// ---------------- State ----------------
let state = null;
let lastTick = 0;
let paused = false;
let speed = 1;
let clouds = [];
let stars = [];
let rain = [];
let snow = [];
let windFactor = 0.55;
let windTarget = 0.55;
let windTimer = 0;

function freshState() {
  return {
    version: 1,
    money: SETTINGS.startMoney,
    day: 1,                  // global day (1-based)
    dayProgress: 0.25,       // start at mid-morning
    plants: { solar: 0, wind: 0, gas: 1, coal: 0, nuclear: 0, hydro: 0, battery: 0 },
    configBaseline: 42,      // MW base demand at season 0
    stress: 0,
    batteryEnergy: 0,
    energyDelivered: 0,      // total MWh-ish
    energyToday: 0,
    daysSurvived: 0,
    activeDisaster: null,    // {key, name, desc, daysLeft}
    disastersSurvived: 0,
    log: [],                  // [{text, kind, day}]
    createdAt: Date.now(),
    updatedAt: Date.now(),
    gameOverReason: null,
    score: 0,
  };
}

// ---------------- Utils ----------------
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function moneyFmt(n) { return '$' + Math.max(0, Math.round(n)).toLocaleString(); }
function moneyFmtRaw(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString(); }
function seasonIndexOf(day) { return Math.floor((day - 1) / SETTINGS.daysPerSeason) % 4; }
function seasonsElapsed(day) { return Math.floor((day - 1) / SETTINGS.daysPerSeason); }
function dayInSeason(day) { return ((day - 1) % SETTINGS.daysPerSeason) + 1; }
function diffMult(day) { return 1 + 0.16 * seasonsElapsed(day); }

// Demand multiplier from an active disaster
function disasterDemandMult() {
  if (!state.activeDisaster) return 1;
  const d = DISASTERS.find(x => x.key === state.activeDisaster.key);
  return d && d.effect.demand ? d.effect.demand : 1;
}
function solarDisasterMult() {
  if (!state.activeDisaster) return 1;
  const d = DISASTERS.find(x => x.key === state.activeDisaster.key);
  return d && d.effect.solar ? d.effect.solar : 1;
}
function windDisasterMult() {
  if (!state.activeDisaster) return 1;
  const d = DISASTERS.find(x => x.key === state.activeDisaster.key);
  return d && d.effect.wind ? d.effect.wind : 1;
}
function hydroDisasterMult() {
  if (!state.activeDisaster) return 1;
  const d = DISASTERS.find(x => x.key === state.activeDisaster.key);
  return d && d.effect.hydro ? d.effect.hydro : 1;
}

function sunFactor(dayProgress) {
  // daylight spans 0.22..0.78 (mid-morning to late evening)
  const t = (dayProgress - 0.22) / 0.56;
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(Math.PI * t);
}
function timeOfDayFactor(d) {
  if (d < 0.2) return 0.72;
  if (d < 0.35) return 0.72 + (d - 0.2) / 0.15 * 0.36;   // morning ramp → 1.08
  if (d < 0.5)  return 1.08 - (d - 0.35) / 0.15 * 0.18;  // midday → 0.90
  if (d < 0.65) return 0.90 + (d - 0.5) / 0.15 * 0.55;   // evening ramp → 1.45
  if (d < 0.82) return 1.45 - (d - 0.65) / 0.17 * 0.65;  // taper → 0.80
  return 0.72 + (d - 0.82) / 0.18 * 0.08;                // night back down
}

function baseDemandMW(day) {
  const s = SEASONS[seasonIndexOf(day)];
  return state.configBaseline * s.demand * diffMult(day);
}
function demandMW(day, dayProgress) {
  return baseDemandMW(day) * timeOfDayFactor(dayProgress) * disasterDemandMult();
}

function plantSupply() {
  const p = state.plants;
  const sIdx = seasonIndexOf(state.day);
  const s = SEASONS[sIdx];
  const sun = sunFactor(state.dayProgress);
  const out = { solar: 0, wind: 0, gas: 0, coal: 0, nuclear: 0, hydro: 0, total: 0 };
  out.solar = p.solar * PLANTS.solar.cap * sun * s.solar * solarDisasterMult();
  out.wind = p.wind * PLANTS.wind.cap * windFactor * s.wind * windDisasterMult();
  out.gas = p.gas * PLANTS.gas.cap * 0.75;
  out.coal = p.coal * PLANTS.coal.cap * 0.90;
  out.nuclear = p.nuclear * PLANTS.nuclear.cap * 0.95;
  out.hydro = p.hydro * PLANTS.hydro.cap * 0.85 * hydroDisasterMult();
  out.total = out.solar + out.wind + out.gas + out.coal + out.nuclear + out.hydro;
  return out;
}

function batteryStorage() {
  return state.plants.battery * PLANTS.battery.storage;
}
function batteryChargeRate() {
  return state.plants.battery * PLANTS.battery.chargeRate;
}
function batteryDischargeRate() {
  return state.plants.battery * PLANTS.battery.dischargeRate;
}

// ---------------- Simulation ----------------
function tick(dt) {
  if (paused || state.gameOverReason) return;

  // --- wind random walk (updates slower than the tick)
  windTimer -= dt;
  if (windTimer <= 0) {
    windTarget = 0.15 + Math.random() * 0.85;
    windTimer = 1.6 + Math.random() * 2.4;
  }
  windFactor += (windTarget - windFactor) * Math.min(1, dt * 0.8);

  // --- advance the clock
  const dayLength = SETTINGS.dayLength / speed;
  state.dayProgress += dt / dayLength;
  if (state.dayProgress >= 1) {
    state.dayProgress -= 1;
    advanceDay();
  }

  // --- power flow
  const demand = demandMW(state.day, state.dayProgress);
  const supply = plantSupply();

  const storage = batteryStorage();
  const chargeRate = batteryChargeRate();
  const dischargeRate = batteryDischargeRate();
  const surplus = supply.total - demand;

  let batteryContribution = 0;
  if (state.plants.battery > 0) {
    if (surplus > 0) {
      const add = Math.min(surplus, chargeRate) * dt;
      state.batteryEnergy = clamp(state.batteryEnergy + add, 0, storage);
    } else if (surplus < 0) {
      const need = Math.min(-surplus, dischargeRate) * dt;
      const used = Math.min(need, state.batteryEnergy);
      state.batteryEnergy -= used;
      batteryContribution = used / dt;
    } else {
      // balanced: no charge/discharge
      state.batteryEnergy = clamp(state.batteryEnergy, 0, storage);
    }
  } else {
    state.batteryEnergy = 0;
  }

  const delivered = Math.min(demand, supply.total + batteryContribution);
  const unmet = Math.max(0, demand - supply.total - batteryContribution);
  const unmetFrac = demand > 0 ? unmet / demand : 0;

  // --- money
  state.money += delivered * 0.35 * dt;
  state.energyDelivered += delivered * dt;
  state.energyToday += delivered * dt;

  // --- stress
  if (unmetFrac > 0) {
    state.stress = clamp(state.stress + unmetFrac * SETTINGS.stressGrowPerSec * dt, 0, 100);
  } else {
    state.stress = clamp(state.stress - SETTINGS.stressDecayPerSec * dt, 0, 100);
  }

  // --- disasters expire at day boundaries handled in advanceDay()
  // --- game over checks
  if (state.stress >= 100) {
    endRun('Blackout', 'The grid could not keep up with demand — the lights went out.', supply, demand);
  } else if (state.money < 0) {
    endRun('Bankruptcy', 'Daily maintenance and construction costs drove the treasury into the red.', supply, demand);
  }

  lastTick = performance.now();
}

function advanceDay() {
  // maintenance
  let maintenance = 0;
  for (const key of Object.keys(state.plants)) {
    const n = state.plants[key];
    if (n <= 0) continue;
    maintenance += n * (key === 'battery' ? SETTINGS.batteryMaintenance : SETTINGS.maintenancePerPlant);
  }
  state.money -= maintenance;

  const prevSeason = seasonIndexOf(state.day);
  state.day += 1;
  state.energyToday = 0;
  state.daysSurvived = state.day - 1;

  const newSeason = seasonIndexOf(state.day);
  if (newSeason !== prevSeason) {
    const s = SEASONS[newSeason];
    pushLog(`${s.name} begins — demand is now ~${Math.round(s.demand * diffMult(state.day) * 100)}% of baseline.`, 'info');
  }

  // disaster expiry / scheduling
  if (state.activeDisaster) {
    state.activeDisaster.daysLeft -= 1;
    if (state.activeDisaster.daysLeft <= 0) {
      pushLog(`The ${state.activeDisaster.name.replace(/^[^\s]+\s/, '')} subsides.`, 'good');
      state.activeDisaster = null;
    }
  }
  if (!state.activeDisaster && state.day >= 4) {
    const chance = Math.min(SETTINGS.disasterBaseChance + SETTINGS.disasterChancePerSeason * seasonsElapsed(state.day), SETTINGS.disasterMaxChance);
    if (Math.random() < chance) {
      const d = DISASTERS[Math.floor(Math.random() * DISASTERS.length)];
      state.activeDisaster = { key: d.key, name: d.name, desc: d.desc, daysLeft: d.days };
      pushLog(`${d.name}! ${d.desc}`, 'disaster');
    }
  }

  if (state.money < 0) {
    endRun('Bankruptcy', 'Daily maintenance costs drove the treasury into the red.');
    return;
  }
}

function endRun(reason, detail, supply, demand) {
  if (state.gameOverReason) return;
  state.gameOverReason = reason;
  state.score = Math.max(0, Math.floor(state.energyDelivered * 2 + state.daysSurvived * 40 + seasonsElapsed(state.day) * 200));
  // persist best score
  const best = loadBest();
  best.push({
    score: state.score,
    days: state.daysSurvived,
    seasons: seasonsElapsed(state.day) + 1,
    energy: Math.round(state.energyDelivered),
    date: new Date().toISOString().slice(0, 10),
  });
  best.sort((a, b) => b.score - a.score);
  saveBest(best.slice(0, 5));
  clearSave();
  showGameOver(reason, detail);
}

// ---------------- Actions ----------------
function buildPlant(key) {
  const def = PLANTS[key];
  if (state.gameOverReason) return;
  const cost = def.cost;
  if (state.money < cost) {
    toast(`Not enough money for ${def.name} (${moneyFmt(cost)})`);
    return;
  }
  state.money -= cost;
  state.plants[key] += 1;
  if (key === 'battery') state.batteryEnergy = Math.min(state.batteryEnergy, batteryStorage());
  pushLog(`Built ${def.name} #${state.plants[key]} for ${moneyFmt(cost)}.`, 'good');
  saveGame(false);
  refreshUI();
}

function sellPlant(key) {
  const def = PLANTS[key];
  if (state.gameOverReason) return;
  if (!state.plants[key]) return;
  state.plants[key] -= 1;
  const refund = Math.floor(def.cost * 0.6);
  state.money += refund;
  if (key === 'battery') state.batteryEnergy = Math.min(state.batteryEnergy, batteryStorage());
  pushLog(`Sold ${def.name} for ${moneyFmt(refund)}.`, 'info');
  saveGame(false);
  refreshUI();
}

// ---------------- Persistence ----------------
function saveGame(quiet = true) {
  const snapshot = {
    version: 1,
    money: state.money,
    day: state.day,
    dayProgress: state.dayProgress,
    plants: { ...state.plants },
    stress: state.stress,
    batteryEnergy: state.batteryEnergy,
    energyDelivered: state.energyDelivered,
    energyToday: state.energyToday,
    daysSurvived: state.daysSurvived,
    activeDisaster: state.activeDisaster ? { ...state.activeDisaster } : null,
    disastersSurvived: state.disastersSurvived,
    log: state.log.slice(-30),
    createdAt: state.createdAt,
    updatedAt: Date.now(),
    score: state.score,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot)); } catch (e) { /* ignore */ }
  if (!quiet) toast('Game saved');
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s || s.version !== 1 || typeof s.money !== 'number' || !s.plants) return false;
    // validate plant counts
    for (const k of PLANT_ORDER) {
      if (typeof s.plants[k] !== 'number' || s.plants[k] < 0) s.plants[k] = 0;
      if (!Number.isFinite(s.plants[k])) s.plants[k] = 0;
    }
    state = Object.assign(freshState(), s);
    state.log = Array.isArray(s.log) ? s.log : [];
    return true;
  } catch (e) {
    return false;
  }
}

function importSaveJSON(text) {
  const s = JSON.parse(text);
  if (!s || s.version !== 1 || typeof s.money !== 'number' || !s.plants) {
    throw new Error('Not a valid Sunnydale save file');
  }
  for (const k of PLANT_ORDER) {
    if (typeof s.plants[k] !== 'number' || s.plants[k] < 0 || !Number.isFinite(s.plants[k])) s.plants[k] = 0;
  }
  s.day = Math.max(1, Math.floor(s.day || 1));
  s.dayProgress = clamp(typeof s.dayProgress === 'number' ? s.dayProgress : 0.5, 0, 1);
  s.stress = clamp(typeof s.stress === 'number' ? s.stress : 0, 0, 100);
  s.batteryEnergy = Math.max(0, typeof s.batteryEnergy === 'number' ? s.batteryEnergy : 0);
  s.energyDelivered = Math.max(0, typeof s.energyDelivered === 'number' ? s.energyDelivered : 0);
  s.daysSurvived = Math.max(0, Math.floor(s.daysSurvived || 0));
  s.log = Array.isArray(s.log) ? s.log.slice(-30) : [];
  s.activeDisaster = s.activeDisaster && s.activeDisaster.key ? s.activeDisaster : null;
  s.gameOverReason = null;
  s.score = 0;
  state = Object.assign(freshState(), s);
  saveGame(false);
  pushLog('Save imported from file.', 'info');
}

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveBest(arr) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(arr)); } catch (e) { /* ignore */ }
}

// ---------------- Log / Toast ----------------
function pushLog(text, kind = 'info') {
  state.log.unshift({ text, kind, day: state.day, ts: Date.now() });
  if (state.log.length > 40) state.log.length = 40;
  renderLog();
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ---------------- Rendering ----------------
const $ = id => document.getElementById(id);
const canvas = $('scene');
const ctx = canvas.getContext('2d');

function initClouds() {
  clouds = [];
  for (let i = 0; i < 4; i++) {
    clouds.push({ x: Math.random() * 720, y: 30 + Math.random() * 90, s: 0.7 + Math.random() * 0.8, speed: 6 + Math.random() * 9 });
  }
  stars = [];
  for (let i = 0; i < 46; i++) {
    stars.push({ x: Math.random() * 720, y: Math.random() * 150, r: 0.8 + Math.random() * 1.4 });
  }
  rain = [];
  for (let i = 0; i < 70; i++) {
    rain.push({ x: Math.random() * 720, y: Math.random() * 300, speed: 260 + Math.random() * 160 });
  }
  snow = [];
  for (let i = 0; i < 50; i++) {
    snow.push({ x: Math.random() * 720, y: Math.random() * 300, speed: 26 + Math.random() * 30, drift: Math.random() * Math.PI * 2 });
  }
}

function drawSky(dt) {
  const sIdx = seasonIndexOf(state.day);
  const s = SEASONS[sIdx];
  const sun = sunFactor(state.dayProgress);
  const dayStrength = clamp(sun * 1.25, 0, 1); // 0 at night, 1 at full sun

  // lerp day/night palettes
  const top = lerpColor(NIGHT_TOP, hexToRgb(s.sky[0]), dayStrength);
  const bottom = lerpColor(NIGHT_BOTTOM, hexToRgb(s.sky[1]), dayStrength);
  const grad = ctx.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, rgb(top));
  grad.addColorStop(1, rgb(bottom));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 720, 300);

  // stars
  if (dayStrength < 0.35) {
    ctx.save();
    for (const st of stars) {
      const tw = 0.5 + 0.5 * Math.sin(performance.now() / 400 + st.x);
      ctx.globalAlpha = (1 - dayStrength / 0.35) * tw;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // sun
  if (sun > 0) {
    const p = (state.dayProgress - 0.22) / 0.56;
    const x = 70 + p * 580;
    const y = 185 - Math.sin(Math.PI * p) * 130;
    const eclipsed = state.activeDisaster && state.activeDisaster.key === 'eclipse';
    const glowR = eclipsed ? 22 : 30 + Math.sin(performance.now() / 500) * 3;
    const glow = ctx.createRadialGradient(x, y, 4, x, y, glowR * 2.4);
    glow.addColorStop(0, eclipsed ? 'rgba(200,200,220,0.9)' : 'rgba(255, 224, 130, 0.95)');
    glow.addColorStop(1, 'rgba(255,224,130,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, glowR * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = eclipsed ? '#9a9ab0' : '#ffdd66';
    ctx.beginPath(); ctx.arc(x, y, eclipsed ? 18 : 26, 0, Math.PI * 2); ctx.fill();
    if (eclipsed) {
      ctx.fillStyle = '#4a4a68';
      ctx.beginPath(); ctx.arc(x - 6, y - 4, 18, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // moon
    const p = state.dayProgress < 0.22 ? (state.dayProgress / 0.22) : ((state.dayProgress - 0.78) / 0.22);
    const x = 70 + p * 580;
    const y = 150 - Math.sin(Math.PI * p) * 90;
    ctx.fillStyle = '#f4f0e0';
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.arc(x - 7, y - 5, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 6, y + 6, 4, 0, Math.PI * 2); ctx.fill();
  }

  // clouds
  for (const c of clouds) {
    c.x += c.speed * dt;
    if (c.x > 800) c.x = -120;
    const a = 0.55 * dayStrength + 0.12;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    const s = c.s;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 22 * s, 0, Math.PI * 2);
    ctx.arc(c.x + 26 * s, c.y - 8 * s, 18 * s, 0, Math.PI * 2);
    ctx.arc(c.x + 52 * s, c.y, 20 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGround(dt) {
  const sIdx = seasonIndexOf(state.day);
  const s = SEASONS[sIdx];
  const dayStrength = clamp(sunFactor(state.dayProgress) * 1.25, 0, 1);
  const groundRgb = lerpColor([70, 70, 100], hexToRgb(s.ground), dayStrength);
  ctx.fillStyle = rgb(groundRgb);
  ctx.beginPath();
  ctx.moveTo(0, 235);
  ctx.quadraticCurveTo(180, 205, 400, 228);
  ctx.quadraticCurveTo(560, 245, 720, 225);
  ctx.lineTo(720, 300);
  ctx.lineTo(0, 300);
  ctx.closePath();
  ctx.fill();

  // flood overlay
  if (state.activeDisaster && state.activeDisaster.key === 'flood') {
    ctx.fillStyle = 'rgba(80, 140, 220, 0.45)';
    ctx.fillRect(0, 255, 720, 45);
  }
}

let plantSlots = [];
function computePlantSlots() {
  const keys = PLANT_ORDER.filter(k => state.plants[k] > 0);
  plantSlots = [];
  const n = keys.length;
  if (n === 0) return;
  // simple icons per plant type, capped at ~10 slots
  keys.forEach((k, i) => {
    const count = state.plants[k];
    const slots = Math.min(count, 3);
    for (let j = 0; j < slots; j++) {
      plantSlots.push({ key: k, kind: 'plant', index: j });
    }
  });
}

function drawPlants(dt) {
  computePlantSlots();
  if (plantSlots.length === 0) return;
  const slotW = 700 / Math.max(plantSlots.length, 1);
  for (let i = 0; i < plantSlots.length; i++) {
    const x = 40 + slotW * (i + 0.5);
    const y = 238;
    drawPlantIcon(plantSlots[i].key, x, y, slotW * 0.62);
  }
}

function drawPlantIcon(key, x, y, size) {
  const s = size / 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const base = '#5a5670';
  if (key === 'solar') {
    ctx.fillStyle = '#3a4a6b';
    ctx.beginPath();
    ctx.moveTo(-18, 6); ctx.lineTo(18, 6); ctx.lineTo(24, -14); ctx.lineTo(-24, -14);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * 9 - 1, 6); ctx.lineTo(i * 9, -14); ctx.stroke();
    }
    ctx.fillStyle = base; ctx.fillRect(-3, 6, 6, 8);
  } else if (key === 'wind') {
    const t = performance.now() / 1000;
    ctx.fillStyle = '#f2f2f8';
    ctx.beginPath();
    ctx.moveTo(-2, 8); ctx.lineTo(2, 8); ctx.lineTo(1.4, -26); ctx.lineTo(-1.4, -26);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#d8d8e8'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#e8e8f4';
    ctx.beginPath(); ctx.arc(0, -26, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(0, -26);
    ctx.rotate(t * 2.4);
    for (let i = 0; i < 3; i++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(26, -5, 34, 0);
      ctx.quadraticCurveTo(26, 5, 0, 0);
      ctx.fill();
      ctx.strokeStyle = '#d8d8e8'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
  } else if (key === 'gas') {
    ctx.fillStyle = '#ffd6a5';
    ctx.strokeStyle = '#d98e4a'; ctx.lineWidth = 2;
    roundRect(-13, -24, 26, 34, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f4a259';
    ctx.beginPath(); ctx.moveTo(0, -18);
    ctx.quadraticCurveTo(8, -8, 0, -2);
    ctx.quadraticCurveTo(-8, -9, 0, -18);
    ctx.fill();
  } else if (key === 'coal') {
    ctx.fillStyle = '#cfd2dd';
    ctx.strokeStyle = '#8a8fa3'; ctx.lineWidth = 2;
    roundRect(-16, -20, 32, 32, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8a8fa3';
    ctx.fillRect(-11, -36, 7, 18);
    ctx.fillRect(4, -36, 7, 18);
    // smoke puff
    const t = performance.now() / 900;
    for (let i = 0; i < 3; i++) {
      const ph = t + i * 2.1;
      const y = -44 - (ph % 3) * 16;
      const alpha = 1 - (ph % 3) / 3;
      ctx.fillStyle = `rgba(200,200,210,${0.55 * alpha})`;
      ctx.beginPath();
      ctx.arc(-7 + Math.sin(ph) * 5, y, 5 + (ph % 3) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (key === 'nuclear') {
    // dome reactor
    ctx.fillStyle = '#e9d9f4';
    ctx.strokeStyle = '#a887c9'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -4, 17, Math.PI, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c9a8dd';
    ctx.fillRect(-24, -6, 48, 12);
    ctx.strokeRect(-24, -6, 48, 12);
    ctx.fillStyle = '#5f5a72';
    ctx.fillRect(-6, -30, 12, 10);
    ctx.fillStyle = '#ffdf80';
    ctx.beginPath(); ctx.arc(0, -13, 4.6, 0, Math.PI * 2); ctx.fill();
  } else if (key === 'hydro') {
    // dam
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2;
    roundRect(-20, -26, 40, 34, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4d96ff';
    ctx.fillRect(-20, -18, 40, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-14, -2, 28, 2.4);
    ctx.fillRect(-14, 4, 28, 2.4);
  } else if (key === 'battery') {
    ctx.fillStyle = '#c7f0b1';
    ctx.strokeStyle = '#4d9b55'; ctx.lineWidth = 2.4;
    roundRect(-15, -24, 30, 40, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4d9b55';
    ctx.fillRect(-7, -30, 14, 6);
    // bolt
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath();
    ctx.moveTo(2, -20); ctx.lineTo(-6, -4); ctx.lineTo(-1, -4); ctx.lineTo(-2, 8); ctx.lineTo(6, -6); ctx.lineTo(1, -6);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHouses(dt) {
  const delivered = lastDeliveredFraction();
  const sIdx = seasonIndexOf(state.day);
  const s = SEASONS[sIdx];
  const night = sunFactor(state.dayProgress) < 0.2;
  const houseCount = 9;
  const spacing = 720 / (houseCount + 1);
  for (let i = 0; i < houseCount; i++) {
    const x = spacing * (i + 1);
    const y = 262;
    const lit = delivered > (i + 0.5) / houseCount;
    // body
    ctx.fillStyle = night ? '#4a4a72' : '#f7e8d8';
    roundRect(x - 20, y - 18, 40, 26, 4); ctx.fill();
    // roof
    ctx.fillStyle = night ? '#3a3a5e' : '#e0704f';
    ctx.beginPath();
    ctx.moveTo(x - 24, y - 18); ctx.lineTo(x, y - 36); ctx.lineTo(x + 24, y - 18);
    ctx.closePath(); ctx.fill();
    // window(s)
    const flicker = lit && state.stress > 60 && Math.random() < 0.08;
    ctx.fillStyle = lit && !flicker ? '#ffe066' : (night ? '#23233d' : '#a8c4dd');
    ctx.fillRect(x - 12, y - 12, 9, 9);
    ctx.fillRect(x + 3, y - 12, 9, 9);
  }
}

let _lastDeliveredFrac = 1;
function lastDeliveredFraction() { return _lastDeliveredFrac; }
function setDeliveredFraction(f) { _lastDeliveredFrac = f; }

function drawDisasterFx() {
  if (!state.activeDisaster) return;
  const key = state.activeDisaster.key;
  if (key === 'storm' || key === 'flood') {
    ctx.save();
    ctx.strokeStyle = 'rgba(210,225,255,0.55)';
    ctx.lineWidth = 1.6;
    for (const r of rain) {
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - 4, r.y + 14);
      ctx.stroke();
    }
    ctx.restore();
  } else if (key === 'coldsnap') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const f of snow) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (key === 'heatwave') {
    ctx.fillStyle = 'rgba(255, 140, 60, 0.13)';
    ctx.fillRect(0, 0, 720, 300);
  } else if (key === 'drought') {
    ctx.fillStyle = 'rgba(190, 140, 70, 0.10)';
    ctx.fillRect(0, 0, 720, 300);
  } else if (key === 'eclipse') {
    ctx.fillStyle = 'rgba(60, 60, 110, 0.18)';
    ctx.fillRect(0, 0, 720, 300);
  }
}

function updateDisasterFx(dt) {
  if (!state.activeDisaster) return;
  const key = state.activeDisaster.key;
  if (key === 'storm' || key === 'flood') {
    for (const r of rain) {
      r.y += r.speed * dt;
      r.x -= r.speed * 0.12 * dt;
      if (r.y > 300) { r.y = -12; r.x = Math.random() * 760; }
    }
  } else if (key === 'coldsnap') {
    for (const f of snow) {
      f.drift += dt * 0.8;
      f.y += f.speed * dt;
      f.x += Math.sin(f.drift) * 0.35;
      if (f.y > 300) { f.y = -8; f.x = Math.random() * 720; }
    }
  }
}

function drawScene(dt) {
  ctx.clearRect(0, 0, 720, 300);
  drawSky(dt);
  drawGround(dt);
  drawPlants(dt);
  drawHouses(dt);
  drawDisasterFx();
  updateDisasterFx(dt);
}

// ---------------- UI ----------------
function updateHUD() {
  const sIdx = seasonIndexOf(state.day);
  const s = SEASONS[sIdx];
  $('hud-clock').textContent = `${s.name} · Day ${dayInSeason(state.day)}/${SETTINGS.daysPerSeason}`;
  $('hud-money').textContent = `💰 ${moneyFmtRaw(state.money)}`;
  $('hud-energy').textContent = `⚡ ${Math.round(state.energyToday)} MWh`;
  $('hud-stress').textContent = `📡 ${Math.round(state.stress)}%`;
  $('hud-stress').style.color = state.stress > 60 ? '#d14040' : '';
  $('season-line').textContent = `Year ${Math.floor((state.day - 1) / 28) + 1} · Season difficulty ×${diffMult(state.day).toFixed(2)}`;
}

function updateFlow() {
  const demand = demandMW(state.day, state.dayProgress);
  const supply = plantSupply();
  const maxScale = Math.max(demand, supply.total, 60) * 1.15;
  $('demand-val').textContent = `${demand.toFixed(1)} MW`;
  $('supply-val').textContent = `${supply.total.toFixed(1)} MW`;
  const fill = $('supply-fill');
  const pct = clamp(supply.total / maxScale * 100, 0, 100);
  fill.style.width = pct + '%';
  const net = supply.total - demand;
  const netEl = $('flow-net');
  if (net >= 0) {
    netEl.textContent = `＋${net.toFixed(1)} MW surplus — charging battery`;
    netEl.className = 'surplus';
  } else {
    netEl.textContent = `−${(-net).toFixed(1)} MW deficit — ${state.batteryEnergy > 1 ? 'battery covering' : 'unmet!'}`;
    netEl.className = 'deficit';
  }
  const marker = $('demand-marker');
  marker.style.left = clamp(demand / maxScale * 100, 0, 98) + '%';
  marker.style.background = net >= 0 ? '#3a3550' : '#d14040';
  setDeliveredFraction(demand > 0 ? clamp(supply.total / demand, 0, 1) : 1);
  if (state.activeDisaster) {
    const d = DISASTERS.find(x => x.key === state.activeDisaster.key);
    const banner = $('disaster-banner');
    banner.textContent = `${state.activeDisaster.name} — ${d.desc} (${state.activeDisaster.daysLeft}d left)`;
    banner.classList.remove('hidden');
  } else {
    $('disaster-banner').classList.add('hidden');
  }
}

function updateMeters() {
  const storage = batteryStorage();
  const pct = storage > 0 ? clamp(state.batteryEnergy / storage * 100, 0, 100) : 0;
  $('battery-fill').style.width = pct + '%';
  $('battery-val').textContent = `${Math.round(state.batteryEnergy)} / ${storage} MWh`;
  $('stress-fill').style.width = clamp(state.stress, 0, 100) + '%';
  $('stress-val').textContent = state.stress >= 60 ? `⚠ ${Math.round(state.stress)}% — close to blackout!` : `${Math.round(state.stress)}%`;
}

function renderLog() {
  const box = $('log');
  box.innerHTML = '';
  for (const entry of state.log) {
    const el = document.createElement('div');
    el.className = 'log-entry ' + (entry.kind || 'info');
    const when = document.createElement('span');
    when.className = 'log-day';
    when.textContent = `Year ${Math.floor((entry.day - 1) / 28) + 1} · ${SEASONS[seasonIndexOf(entry.day)].name} · Day ${dayInSeason(entry.day)}`;
    const body = document.createElement('span');
    body.textContent = entry.text;
    el.appendChild(when);
    el.appendChild(body);
    box.appendChild(el);
  }
}

function renderShop() {
  const box = $('shop-cards');
  box.innerHTML = '';
  for (const key of PLANT_ORDER) {
    const def = PLANTS[key];
    const owned = state.plants[key];
    const card = document.createElement('div');
    card.className = 'plant-card';
    if (state.money >= def.cost && !state.gameOverReason) card.classList.add('can-build');
    if (state.money < def.cost) card.classList.add('unaffordable');

    const top = document.createElement('div');
    top.className = 'plant-top';

    const icon = document.createElement('div');
    icon.className = 'plant-icon';
    icon.style.background = def.color;
    icon.textContent = def.icon;

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'plant-name';
    name.textContent = def.name;
    const meta = document.createElement('div');
    meta.className = 'plant-meta';
    const capText = def.cap ? `${def.cap} MW` : `${def.storage} MWh`;
    meta.textContent = `${capText} · ${moneyFmt(def.cost)}`;
    info.appendChild(name);
    info.appendChild(meta);

    top.appendChild(icon);
    top.appendChild(info);

    const owned_ = document.createElement('div');
    owned_.className = 'plant-owned' + (owned === 0 ? ' zero' : '');
    owned_.textContent = `×${owned}`;

    const tag = document.createElement('div');
    tag.className = 'plant-tagline';
    tag.textContent = def.tagline;

    const sell = document.createElement('button');
    sell.className = 'plant-sell';
    sell.textContent = owned > 0 ? `Sell 1 · +${moneyFmt(Math.floor(def.cost * 0.6))}` : 'Owned: none';
    sell.disabled = owned === 0 || !!state.gameOverReason;
    sell.addEventListener('click', ev => {
      ev.stopPropagation();
      sellPlant(key);
    });

    card.appendChild(top);
    card.appendChild(owned_);
    card.appendChild(tag);
    card.appendChild(sell);

    card.addEventListener('click', () => buildPlant(key));
    box.appendChild(card);
  }
}

function refreshUI() {
  updateHUD();
  updateFlow();
  updateMeters();
  renderShop();
  renderLog();
}

// ---------------- Game over ----------------
function showGameOver(reason, detail) {
  const overlay = $('gameover-overlay');
  $('gameover-title').textContent = reason === 'Blackout' ? '🔌 Blackout!' : '💸 Bankruptcy!';
  $('gameover-reason').textContent = detail;
  $('gameover-score').textContent = state.score;

  const breakdown = $('gameover-breakdown');
  breakdown.innerHTML = '';
  const rows = [
    ['Days survived', state.daysSurvived],
    ['Seasons reached', seasonsElapsed(state.day) + 1],
    ['Energy delivered', `${Math.round(state.energyDelivered)} MWh`],
    ['Plants built', Object.entries(state.plants).reduce((a, [, v]) => a + v, 0)],
    ['Score', state.score],
  ];
  for (const [k, v] of rows) {
    const li = document.createElement('li');
    const l = document.createElement('span'); l.textContent = k;
    const r = document.createElement('span'); r.textContent = v;
    li.appendChild(l); li.appendChild(r);
    breakdown.appendChild(li);
  }

  const best = loadBest();
  const ol = $('best-scores');
  ol.innerHTML = '';
  best.forEach((b, i) => {
    const li = document.createElement('li');
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `#${i + 1}`;
    const mid = document.createElement('span');
    mid.textContent = `${b.days}d · ${b.energy} MWh`;
    const sc = document.createElement('span');
    sc.textContent = b.score;
    li.appendChild(rank); li.appendChild(mid); li.appendChild(sc);
    ol.appendChild(li);
  });

  overlay.classList.remove('hidden');
}

// ---------------- Misc helpers ----------------
function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function rgb(arr) { return `rgb(${Math.round(arr[0])},${Math.round(arr[1])},${Math.round(arr[2])})`; }
function lerpColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------- Color of night palette (used by drawSky) ----------------
const NIGHT_TOP = [34, 34, 74];
const NIGHT_BOTTOM = [58, 58, 110];

// ---------------- Main loop ----------------
function loop(now) {
  const dt = Math.min(0.05, (now - lastTick) / 1000 || 0);
  lastTick = now;
  if (!paused && state && !state.gameOverReason) {
    tick(dt);
  }
  if (state) {
    drawScene(dt);
  }
  if (state && !state.gameOverReason) {
    updateFlow();
    updateMeters();
    updateHUD();
  }
  requestAnimationFrame(loop);
}

// ---------------- Init ----------------
function startNewGame() {
  state = freshState();
  clearSave();
  paused = false;
  speed = 1;
  $('btn-speed').textContent = '1×';
  windFactor = 0.55;
  windTarget = 0.55;
  windTimer = 2;
  initClouds();
  $('gameover-overlay').classList.add('hidden');
  pushLog('Welcome to Sunnydale! Keep the grid fed.', 'info');
  pushLog('Demand peaks in the evening — build plants from the shop.', 'info');
  pushLog('Disasters will strike. Batteries and spare plants help.', 'info');
  refreshUI();
}

function applySave(restarted) {
  windFactor = 0.55;
  windTarget = 0.55;
  windTimer = 2;
  initClouds();
  $('gameover-overlay').classList.add('hidden');
  $('btn-speed').textContent = '1×';
  refreshUI();
}

function init() {
  initClouds();
  const loaded = loadSave();
  if (loaded) {
    applySave();
    pushLog('Welcome back — your game was restored.', 'info');
    saveGame(true);
  } else {
    startNewGame();
  }
  // wire buttons
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-speed').addEventListener('click', toggleSpeed);
  $('btn-save').addEventListener('click', () => saveGame(false));
  $('btn-export').addEventListener('click', exportSave);
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', importSaveFromFile);
  $('btn-new').addEventListener('click', () => {
    if (confirm('Start a new game? Your current progress will be lost (best scores are kept).')) {
      clearSave();
      startNewGame();
    }
  });
  $('btn-again').addEventListener('click', () => {
    clearSave();
    startNewGame();
  });
  window.addEventListener('keydown', ev => {
    if (ev.code === 'Space' && !ev.repeat) {
      ev.preventDefault();
      togglePause();
    }
  });
  setInterval(() => { if (state && !state.gameOverReason) saveGame(true); }, 6000);
  requestAnimationFrame(loop);
}

function togglePause() {
  paused = !paused;
  $('btn-pause').textContent = paused ? '▶️' : '⏸️';
  $('scene').classList.toggle('paused', paused);
}

function toggleSpeed() {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  $('btn-speed').textContent = speed + '×';
}

function exportSave() {
  if (!state || state.gameOverReason) { toast('Nothing to export right now'); return; }
  const s = {
    version: 1,
    money: state.money,
    day: state.day,
    dayProgress: state.dayProgress,
    plants: { ...state.plants },
    stress: state.stress,
    batteryEnergy: state.batteryEnergy,
    energyDelivered: state.energyDelivered,
    daysSurvived: state.daysSurvived,
    activeDisaster: state.activeDisaster ? { ...state.activeDisaster } : null,
    disastersSurvived: state.disastersSurvived,
    log: state.log.slice(-30),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sunnydale-save-day${state.day}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  toast('Save exported');
}

function importSaveFromFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importSaveJSON(reader.result);
      refreshUI();
      toast('Save imported');
    } catch (e) {
      toast('Invalid save file: ' + e.message);
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

document.addEventListener('DOMContentLoaded', init);
