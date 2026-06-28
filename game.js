// ---- BIG BUSINESS SIMULATOR ----
// Parody idle clicker. Edit GENERATORS / TUNING to design the game.

const SAVE_KEY = "big-business-sim-save";
const SCORES_KEY = "big-business-sim-scores";
const MAX_SCORES = 10;
const MAX_INVESTIGATIONS = 4; // hit this many -> auto game over
const DELIST_PRICE = 1.0; // stock at/under this -> delisted (game over)
const IPO_PRICE = 90; // opening share price
const TICK_MS = 100; // game loop interval
const AUTOSAVE_MS = 15000; // autosave interval
const COST_GROWTH = 1.15; // price multiplier per owned unit

const TUNING = {
  clickHeat: 0.4, // suspicion added per manual "Mark to Market"
  shredCut: 12, // suspicion removed per shred click
  shredCooldownMs: 1500, // shred button cooldown
  investigationLoss: 0.4, // fraction of earnings seized at 100% heat
  investigationReset: 50, // heat left after an investigation
  heatPerEarning: 0.000003, // passive heat per $ of reported earnings booked
};

// Each generator:
//   id, name, desc
//   baseCost, cps   (reported earnings/sec per unit)
//   heat            (suspicion/sec per unit; NEGATIVE = launders/hides)
const GENERATORS = [
  {
    id: "mtm",
    name: "Mark-to-Market Spreadsheet",
    desc: "Book 20 years of profit today.",
    baseCost: 15,
    cps: 0.2,
    heat: 0.03,
  },
  {
    id: "spe",
    name: "Special Purpose Entity",
    desc: "Meet Raptor, Chewco & LJM.",
    baseCost: 110,
    cps: 1.5,
    heat: 0.12,
  },
  {
    id: "trader",
    name: "California Energy Trader",
    desc: "Cause blackout, resell at 10x.",
    baseCost: 1300,
    cps: 9,
    heat: 0.6,
  },
  {
    id: "auditor",
    name: "Arthur Andersen Auditor",
    desc: "Signs anything. Owns a shredder.",
    baseCost: 14000,
    cps: 12,
    heat: -0.8,
  },
  {
    id: "broadband",
    name: "Broadband Futures Desk",
    desc: "Sell bandwidth that doesn't exist.",
    baseCost: 160000,
    cps: 90,
    heat: 1.5,
  },
  {
    id: "shell",
    name: "Offshore Cayman Shell Co.",
    desc: "Nesting-doll companies. Untraceable.",
    baseCost: 2000000,
    cps: 500,
    heat: -2.2,
  },
  {
    id: "lobby",
    name: "Congressional Lobbyist",
    desc: "Buy the referees.",
    baseCost: 25000000,
    cps: 4000,
    heat: -5,
  },
];

// One-time upgrades (permanent modifiers). effect keys are multipliers:
//   clickHeatMult  - heat per manual click
//   heatGainMult   - passive heat generation (positive rate only); stacks
//   shredMult      - heat removed per shred
//   cooldownMult   - shred cooldown duration
//   lossMult       - earnings seized per SEC raid
//   earnMult       - all earnings (click + passive); stacks
const UPGRADES = [
  {
    id: "golf",
    name: "Auditor Golf Retreat",
    desc: "Click heat −60%.",
    cost: 20000,
    effect: { clickHeatMult: 0.4 },
  },
  {
    id: "shredder",
    name: "Industrial Shredder",
    desc: "Shred removes 2× heat.",
    cost: 35000,
    effect: { shredMult: 2 },
  },
  {
    id: "retention",
    name: "Document Retention Policy",
    desc: "Shred cooldown −50%.",
    cost: 60000,
    effect: { cooldownMult: 0.5 },
  },
  {
    id: "footnotes",
    name: "Aggressive Footnotes",
    desc: "All passive heat −25%.",
    cost: 120000,
    effect: { heatGainMult: 0.75 },
  },
  {
    id: "revolving",
    name: "Revolving-Door Lawyers",
    desc: "SEC seizes 30% less per raid.",
    cost: 400000,
    effect: { lossMult: 0.7 },
  },
  {
    id: "offbalance",
    name: "Off-Balance-Sheet Magic",
    desc: "All passive heat −40% (stacks).",
    cost: 1500000,
    effect: { heatGainMult: 0.6 },
  },
  {
    id: "pr",
    name: "Pump-&-Dump PR Firm",
    desc: "All earnings ×2.",
    cost: 5000000,
    effect: { earnMult: 2 },
  },
];

// ---- Game state ----
const state = {
  currency: 0,
  perClick: 1,
  owned: {},
  upgrades: {},
  suspicion: 0,
  investigations: 0,
  peakEarnings: 0,
  company: null, // { name, ticker }
  lastSeen: Date.now(),
};

// ---- Engine ----
function generatorCost(gen) {
  const count = state.owned[gen.id] || 0;
  return Math.ceil(gen.baseCost * Math.pow(COST_GROWTH, count));
}

function totalCps() {
  return GENERATORS.reduce((s, g) => s + (state.owned[g.id] || 0) * g.cps, 0);
}

// raw share price (can fall below the $0.26 display floor -> delisting)
// climbs with peak earnings, sinks with live heat + permanent raid damage
function sharePrice() {
  return (
    IPO_PRICE +
    Math.log10(state.peakEarnings + 1) * 6 -
    state.suspicion * 0.8 -
    state.investigations * 25
  );
}

// net suspicion change per second from owned generators (can be negative).
// upgrades only dampen heat being *generated* (positive net), not laundering.
function heatRate() {
  const rate = GENERATORS.reduce(
    (s, g) => s + (state.owned[g.id] || 0) * g.heat,
    0,
  );
  return rate > 0 ? rate * upgMult("heatGainMult") : rate;
}

function buy(gen) {
  const cost = generatorCost(gen);
  if (state.currency < cost) return;
  state.currency -= cost;
  state.owned[gen.id] = (state.owned[gen.id] || 0) + 1;
  renderShop();
  render();
}

// combined multiplier for an effect key across all owned upgrades (multiplicative)
function upgMult(key) {
  let m = 1;
  for (const u of UPGRADES) {
    if (state.upgrades[u.id] && u.effect[key] != null) m *= u.effect[key];
  }
  return m;
}

function buyUpgrade(up) {
  if (state.upgrades[up.id]) return; // already owned
  if (state.currency < up.cost) return;
  state.currency -= up.cost;
  state.upgrades[up.id] = true;
  renderUpgrades();
  render();
  flashStatus("Acquired: " + up.name);
}

function addEarnings(amount) {
  state.currency += amount;
  state.suspicion += amount * TUNING.heatPerEarning;
  if (state.currency > state.peakEarnings) state.peakEarnings = state.currency;
}

function click(ev) {
  const gain = state.perClick * upgMult("earnMult");
  addEarnings(gain);
  state.suspicion += TUNING.clickHeat * upgMult("clickHeatMult");
  clampHeat();
  if (ev) spawnFloat(ev.clientX, ev.clientY, "+" + format(gain));
  render();
}

// ---- Suspicion ----
function clampHeat() {
  if (state.suspicion < 0) state.suspicion = 0;
  if (state.suspicion >= 100) triggerInvestigation();
}

function triggerInvestigation() {
  state.investigations++;
  if (state.investigations >= MAX_INVESTIGATIONS) {
    gameOver();
    return;
  }
  // repeat offenses bite harder
  const lossFrac = Math.min(
    0.85,
    (TUNING.investigationLoss + state.investigations * 0.05) *
      upgMult("lossMult"),
  );
  const seized = state.currency * lossFrac;
  state.currency -= seized;
  state.suspicion = TUNING.investigationReset;
  showModal(
    "SEC INVESTIGATION #" + state.investigations,
    "The feds froze the books. <b>$" +
      format(seized) +
      "</b> in reported earnings " +
      "vanished (" +
      Math.round(lossFrac * 100) +
      "% seized). " +
      "Heat reset to " +
      TUNING.investigationReset +
      "%. Lawyer up and get back to work.",
  );
}

let lastShred = 0;
function shredCooldown() {
  return TUNING.shredCooldownMs * upgMult("cooldownMult");
}
function shred() {
  const now = Date.now();
  if (now - lastShred < shredCooldown()) return;
  lastShred = now;
  state.suspicion -= TUNING.shredCut * upgMult("shredMult");
  clampHeat();
  render();
  flashStatus("Documents shredded.");
}

// ---- Loop ----
let lastTick = Date.now();
function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  addEarnings(totalCps() * upgMult("earnMult") * dt);
  state.suspicion += heatRate() * dt;
  clampHeat();
  render();
}

// ---- Persistence ----
function save() {
  state.lastSeen = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  flashStatus("Saved");
}

function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    Object.assign(state, data);
    state.owned = data.owned || {};
    state.upgrades = data.upgrades || {};
    applyOfflineEarnings();
  } catch (e) {
    console.warn("Bad save, ignoring.", e);
  }
}

function applyOfflineEarnings() {
  if (!state.lastSeen) return;
  const elapsed = (Date.now() - state.lastSeen) / 1000;
  if (elapsed <= 0) return;
  const earned = totalCps() * upgMult("earnMult") * elapsed;
  if (earned > 0) {
    addEarnings(earned);
    state.suspicion += heatRate() * elapsed;
    clampHeat();
    flashStatus("Booked $" + format(earned) + " in 'profits' while away");
  }
}

// wipe the current run (no confirm, no score). Caller handles score + UI.
function hardReset() {
  localStorage.removeItem(SAVE_KEY);
  state.currency = 0;
  state.perClick = 1;
  state.owned = {};
  state.upgrades = {};
  state.suspicion = 0;
  state.investigations = 0;
  state.peakEarnings = 0;
  state.company = null;
  renderShop();
  renderUpgrades();
  render();
}

// manual bankruptcy via Control Panel
function reset() {
  if (
    !confirm(
      "Declare bankruptcy? Shareholders & employees lose everything. You keep your bonus.",
    )
  )
    return;
  recordScore();
  hardReset();
  flashStatus("Chapter 11 filed. Golden parachute deployed.");
  openScores();
}

// forced bankruptcy after MAX_INVESTIGATIONS
function gameOver() {
  const name = state.company ? state.company.name : "Your shell";
  recordScore(); // logs final peak under current company
  hardReset();
  showModal(
    "GAME OVER — FEDERAL RAID",
    "After <b>" +
      MAX_INVESTIGATIONS +
      " SEC investigations</b>, the FBI raided " +
      name +
      ". Assets frozen, books subpoenaed, you're doing a perp walk. " +
      "The company is finished. Your high score has been filed in the Hall of Shame.",
  );
}

// forced bankruptcy when the stock collapses
function delist() {
  const name = state.company ? state.company.name : "Your shell";
  const sym = state.company ? state.company.ticker : "BIGB";
  recordScore();
  hardReset();
  showModal(
    "DELISTED — STOCK HITS $0.26",
    "<b>" +
      sym +
      "</b> cratered to $0.26 and was kicked off the NASDAQ. " +
      name +
      " is worthless, employee 401(k)s are vaporized, and the press " +
      "smells blood. Game over. Your high score has been filed in the Hall of Shame.",
  );
}

// ---- Company setup ----
function applyCompany() {
  if (!state.company) return;
  document.getElementById("tickerSym").textContent = state.company.ticker;
  document.getElementById("taskTitle").textContent =
    state.company.name + " Profit Maximizer";
}

function showSetup() {
  const modal = document.getElementById("setupModal");
  const nameIn = document.getElementById("companyNameInput");
  const tickIn = document.getElementById("companyTickerInput");
  const err = document.getElementById("setupErr");
  nameIn.value = "";
  tickIn.value = "";
  err.textContent = "";
  modal.classList.remove("hidden");
  nameIn.focus();
}

function submitSetup() {
  const name = document.getElementById("companyNameInput").value.trim();
  const ticker = document
    .getElementById("companyTickerInput")
    .value.toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 4);
  const err = document.getElementById("setupErr");
  if (name.length < 2) {
    err.textContent = "Need a company name.";
    return;
  }
  if (ticker.length < 1) {
    err.textContent = "Need a ticker (letters only).";
    return;
  }
  state.company = { name, ticker };
  applyCompany();
  render();
  save();
  document.getElementById("setupModal").classList.add("hidden");
  flashStatus(name + " (" + ticker + ") is open for business.");
}

// ---- High scores ----
function loadScores() {
  try {
    return JSON.parse(localStorage.getItem(SCORES_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function recordScore() {
  if (state.peakEarnings < 1) return;
  const sym = state.company ? state.company.ticker : "ENRN";
  const name = state.company ? state.company.name : "Unknown LLC";
  const scores = loadScores();
  scores.push({
    sym,
    name,
    score: Math.floor(state.peakEarnings),
    investigations: state.investigations,
    date: Date.now(),
  });
  scores.sort((a, b) => b.score - a.score);
  localStorage.setItem(SCORES_KEY, JSON.stringify(scores.slice(0, MAX_SCORES)));
}

function renderScores() {
  const scores = loadScores();
  const body = document.getElementById("scoresBody");
  const tape = document.getElementById("nasdaqTape");

  if (!scores.length) {
    body.innerHTML =
      '<div class="nasdaq-empty">No filings yet. Go cook some books, then declare bankruptcy.</div>';
    tape.textContent = "BIGB +0.00%   MARKETS AWAIT YOUR FRAUD ...   ";
    return;
  }

  let rows =
    '<div class="nasdaq-row head"><span>#</span><span>SYMBOL</span><span>PEAK EARNINGS</span><span>RAIDS</span></div>';
  scores.forEach((s, i) => {
    rows += `<div class="nasdaq-row ${i === 0 ? "top1" : ""}" title="${s.name || ""}">
      <span class="rank">${i + 1}</span>
      <span class="ticker-sym">${s.sym}</span>
      <span class="score">$${format(s.score)}</span>
      <span class="meta">▲ ${s.investigations}</span>
    </div>`;
  });
  body.innerHTML = rows;

  tape.textContent =
    scores.map((s) => `${s.sym} $${format(s.score)} ▲`).join("     ") + "     ";
}

function openScores() {
  renderScores();
  document.getElementById("scoresModal").classList.remove("hidden");
}
function closeScores() {
  document.getElementById("scoresModal").classList.add("hidden");
  if (!state.company) showSetup(); // returning from bankruptcy -> re-incorporate
}

// ---- Rendering ----
const el = {
  currency: document.getElementById("currency"),
  cps: document.getElementById("cps"),
  perClick: document.getElementById("perClick"),
  shop: document.getElementById("shop"),
  upgrades: document.getElementById("upgrades"),
  status: document.getElementById("status"),
  suspicionBar: document.getElementById("suspicionBar"),
  suspicionPct: document.getElementById("suspicionPct"),
  shredBtn: document.getElementById("shredBtn"),
  stockPrice: document.getElementById("stockPrice"),
  stockArrow: document.getElementById("stockArrow"),
  ticker: document.querySelector(".ticker"),
};

function format(n) {
  if (n < 1000) {
    if (Number.isInteger(n)) return String(n);
    return n < 10 ? n.toFixed(1) : String(Math.floor(n));
  }
  const units = ["", "K", "M", "B", "T", "Qa", "Qi"];
  const tier = Math.min(Math.floor(Math.log10(n) / 3), units.length - 1);
  return (n / Math.pow(1000, tier)).toFixed(2) + units[tier];
}

function render() {
  el.currency.textContent = format(Math.floor(state.currency));
  el.cps.textContent = format(totalCps());
  el.perClick.textContent = format(state.perClick);

  // suspicion meter
  const pct = Math.max(0, Math.min(100, state.suspicion));
  el.suspicionBar.style.width = pct + "%";
  el.suspicionPct.textContent = Math.round(pct) + "%";
  el.suspicionBar.classList.toggle("hot", pct >= 75);

  // shred cooldown
  el.shredBtn.disabled = Date.now() - lastShred < shredCooldown();

  // fake stock price: climbs with peak earnings, tanks with heat + raid damage
  const raw = sharePrice();
  const price = Math.max(0.26, raw);
  el.stockPrice.textContent = price.toFixed(2);
  const down = raw < IPO_PRICE; // below opening price = ▼
  el.stockArrow.textContent = down ? "▼" : "▲";
  el.stockArrow.classList.toggle("down", down);
  el.ticker.classList.toggle("down", down);

  // delisting = game over (guard against re-fire after company wiped)
  if (state.company && raw <= DELIST_PRICE) {
    delist();
    return;
  }

  // generator costs
  for (const gen of GENERATORS) {
    const node = document.getElementById("item-" + gen.id);
    if (!node) continue;
    const cost = generatorCost(gen);
    const affordable = state.currency >= cost;
    node.classList.toggle("locked", !affordable);
    const costEl = node.querySelector(".cost");
    costEl.textContent = format(cost);
    costEl.classList.toggle("affordable", affordable);
    node.querySelector(".count-n").textContent = state.owned[gen.id] || 0;
  }

  // upgrade affordability
  for (const up of UPGRADES) {
    const node = document.getElementById("upg-" + up.id);
    if (!node) continue;
    const owned = !!state.upgrades[up.id];
    const affordable = owned || state.currency >= up.cost;
    node.classList.toggle("locked", !affordable);
    const costEl = node.querySelector(".cost");
    if (costEl) costEl.classList.toggle("affordable", !owned && affordable);
  }
}

function renderUpgrades() {
  if (!el.upgrades) return;
  el.upgrades.innerHTML = "";
  for (const up of UPGRADES) {
    const owned = !!state.upgrades[up.id];
    const node = document.createElement("div");
    node.className = "shop-item upgrade" + (owned ? " owned" : "");
    node.id = "upg-" + up.id;
    node.innerHTML = `
      <div class="item-info">
        <div class="name">${up.name}</div>
        <div class="desc">${up.desc}</div>
      </div>
      <div class="item-buy">
        ${
          owned
            ? '<div class="owned-tag">OWNED</div>'
            : `<div class="cost">${format(up.cost)}</div>`
        }
      </div>`;
    if (!owned) node.addEventListener("click", () => buyUpgrade(up));
    el.upgrades.appendChild(node);
  }
}

function renderShop() {
  el.shop.innerHTML = "";
  for (const gen of GENERATORS) {
    const count = state.owned[gen.id] || 0;
    const heatTxt =
      gen.heat >= 0
        ? `<span class="heat up">+${gen.heat}/s heat</span>`
        : `<span class="heat down">${gen.heat}/s heat (hides)</span>`;
    const node = document.createElement("div");
    node.className = "shop-item";
    node.id = "item-" + gen.id;
    node.innerHTML = `
      <div class="item-info">
        <div class="name">${gen.name}</div>
        <div class="desc">${gen.desc}</div>
        <div>+${format(gen.cps)}/s &middot; ${heatTxt}</div>
      </div>
      <div class="item-buy">
        <div class="cost">${format(generatorCost(gen))}</div>
        <div class="count">owned: <span class="count-n">${count}</span></div>
      </div>`;
    node.addEventListener("click", () => buy(gen));
    el.shop.appendChild(node);
  }
}

function spawnFloat(x, y, text) {
  const f = document.createElement("div");
  f.className = "float";
  f.textContent = text;
  f.style.left = x + "px";
  f.style.top = y + "px";
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 900);
}

let statusTimer;
function flashStatus(msg) {
  el.status.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.status.textContent = "Ready."), 3000);
}

// fake taskbar clock
function tickClock() {
  const clock = document.getElementById("clock");
  if (!clock) return;
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  clock.textContent = h + ":" + m + " " + ap;
}

// ---- Modal ----
function showModal(title, bodyHtml) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  document.getElementById("modal").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  if (!state.company) openScores(); // game over -> show Hall of Shame, then re-incorporate
}

// ---- Boot ----
function init() {
  load();
  applyCompany();
  renderShop();
  renderUpgrades();
  render();
  document.getElementById("clickBtn").addEventListener("click", click);
  document.getElementById("shredBtn").addEventListener("click", shred);
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("resetBtn").addEventListener("click", reset);
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modalCloseX").addEventListener("click", closeModal);
  const helpModal = document.getElementById("helpModal");
  const openHelp = () => helpModal.classList.remove("hidden");
  const closeHelp = () => helpModal.classList.add("hidden");
  document.getElementById("helpMenu").addEventListener("click", openHelp);
  document.getElementById("helpClose").addEventListener("click", closeHelp);
  document.getElementById("helpCloseX").addEventListener("click", closeHelp);
  document.getElementById("scoresBtn").addEventListener("click", openScores);
  document.getElementById("scoresClose").addEventListener("click", closeScores);
  document
    .getElementById("scoresCloseX")
    .addEventListener("click", closeScores);
  document.getElementById("setupGo").addEventListener("click", submitSetup);
  document.getElementById("setupHelp").addEventListener("click", openHelp);
  document
    .getElementById("companyTickerInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitSetup();
    });
  tickClock();
  setInterval(tickClock, 10000);
  lastTick = Date.now();
  setInterval(tick, TICK_MS);
  setInterval(save, AUTOSAVE_MS);
  window.addEventListener("beforeunload", save);

  if (!state.company) showSetup(); // first launch -> incorporate
}

init();
