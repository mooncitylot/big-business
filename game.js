// ---- BIG BUSINESS SIMULATOR ----
// Parody idle clicker. Edit GENERATORS / TUNING to design the game.

const SAVE_KEY = "big-business-sim-save-v2";
const SCORES_KEY = "big-business-sim-scores";
const MAX_SCORES = 10;
const MAX_INVESTIGATIONS = 4; // hit this many -> auto game over
const DELIST_PRICE = 1.0; // stock at/under this -> delisted (game over)
const IPO_PRICE = 90; // opening share price
const TICK_MS = 100; // game loop interval
const AUTOSAVE_MS = 15000; // autosave interval
const COST_GROWTH = 1.15; // price multiplier per owned unit

const TUNING = {
  clickHeat: 0.25, // suspicion added per manual "Mark to Market"
  shredCut: 14, // suspicion removed per shred click
  shredCooldownMs: 1500, // shred button cooldown
  investigationLoss: 0.35, // fraction of earnings seized at 100% heat
  investigationReset: 40, // heat left after an investigation
  heatPerEarning: 0.0000000015, // passive heat per $ booked (money scaled ×1000)
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
    baseCost: 15000,
    cps: 200,
    heat: 0.04,
  },
  {
    id: "spe",
    name: "Special Purpose Entity",
    desc: "Vandelay Industries.",
    baseCost: 110000,
    cps: 1500,
    heat: 0.1,
  },
  {
    id: "trader",
    name: "Energy Trader",
    desc: "Cause a blackout, and resell at 10x.",
    baseCost: 1300000,
    cps: 9000,
    heat: 0.5,
  },
  {
    id: "auditor",
    name: "In-House Auditor",
    desc: "Signs anything and owns a shredder.",
    baseCost: 14000000,
    cps: 12000,
    heat: -0.8,
  },
  {
    id: "broadband",
    name: "Broadband Futures Desk",
    desc: "Sell bandwidth that doesn't exist.",
    baseCost: 160000000,
    cps: 90000,
    heat: 1.0,
  },
  {
    id: "shell",
    name: "Offshore Shell Co.",
    desc: "Companies inside companies inside companies inside...",
    baseCost: 2000000000,
    cps: 500000,
    heat: -2,
  },
  {
    id: "lobby",
    name: "Congressional Lobbyist",
    desc: "An 80 year old white man in your back pocket.",
    baseCost: 25000000000,
    cps: 4000000,
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
  // --- entry-level creative accounting: cheap, all lower SEC suspicion ---
  {
    id: "ledger",
    name: "Creative Bookkeeping 101",
    desc: "All passive heat −15%.",
    cost: 3000,
    effect: { heatGainMult: 0.85 },
  },
  {
    id: "rounding",
    name: "Round in Our Favor",
    desc: "Click heat −40%.",
    cost: 5000,
    effect: { clickHeatMult: 0.6 },
  },
  {
    id: "secretary",
    name: "The Fixer",
    desc: "Auto-shreds at 100% heat, resetting it to 10%. One-time-use.",
    cost: 8000,
    charges: 1, // consumable: auto-saves from investigation 3 times
  },
  {
    id: "restate",
    name: "Quarterly Restatement",
    desc: "All passive heat −20% (stacks).",
    cost: 18000,
    effect: { heatGainMult: 0.8 },
  },
  // --- mid/late damage control ---
  {
    id: "golf",
    name: "Auditor Golf Retreat",
    desc: "Click heat −60% (stacks).",
    cost: 40000,
    effect: { clickHeatMult: 0.4 },
  },
  {
    id: "shredder",
    name: "Industrial Shredder",
    desc: "Shred removes 2× heat.",
    cost: 75000,
    effect: { shredMult: 2 },
  },
  {
    id: "retention",
    name: "Document Retention Policy",
    desc: "Shred cooldown −50%.",
    cost: 150000,
    effect: { cooldownMult: 0.5 },
  },
  {
    id: "footnotes",
    name: "Aggressive Footnotes",
    desc: "All passive heat −25% (stacks).",
    cost: 350000,
    effect: { heatGainMult: 0.75 },
  },
  {
    id: "revolving",
    name: "Revolving-Door Lawyers",
    desc: "SEC seizes 30% less per raid.",
    cost: 900000,
    effect: { lossMult: 0.7 },
  },
  {
    id: "offbalance",
    name: "Off-Balance-Sheet Magic",
    desc: "All passive heat −40% (stacks).",
    cost: 3000000,
    effect: { heatGainMult: 0.6 },
  },
  {
    id: "pr",
    name: "Pump-&-Dump PR Firm",
    desc: "All earnings ×1.5.",
    cost: 12000000,
    effect: { earnMult: 1.5 },
  },
];

// Career ladder: a linear sequence of job titles, promoted in order as
// peak earnings cross each tier (power-of-ten threshold). No branching,
// no skipping — one rank after another, Underwriter -> CEO.
const LEVELS = [
  { title: "Underwriter", tier: 0 },
  { title: "Junior Analyst", tier: 4 },
  { title: "Senior Analyst", tier: 5 },
  { title: "Associate Director", tier: 6 },
  { title: "VP of Synergy", tier: 7 },
  { title: "Senior VP of Strategy", tier: 8 },
  { title: "Managing Director", tier: 9 },
  { title: "Executive Vice President", tier: 10 },
  { title: "Chief Operating Officer", tier: 11 },
  { title: "President", tier: 12 },
  { title: "Chief Executive Officer", tier: 13 },
];

// ---- Game state ----
const state = {
  currency: 0,
  perClick: 1000,
  owned: {},
  upgrades: {},
  suspicion: 0,
  investigations: 0,
  peakEarnings: 0,
  secretaryCharges: 0, // remaining auto-shred saves from Damage-Control Secretary
  level: 0, // index into LEVELS
  revealedGens: {}, // gen.id -> true once its title has ever been affordable
  revealedUpgrades: {}, // up.id -> true once its title has ever been affordable
  company: null, // { name, ticker }
  employee: null, // { name, photo } once the ID badge has been printed
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

// index of the highest rank whose tier threshold peak earnings have crossed
function currentLevelIndex() {
  const tier =
    state.peakEarnings >= 1 ? Math.floor(Math.log10(state.peakEarnings)) : 0;
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (tier >= LEVELS[i].tier) idx = i;
  }
  return idx;
}

// progress toward the next rank, for the career meter
function levelProgress() {
  const idx = currentLevelIndex();
  if (idx >= LEVELS.length - 1) return { idx, pct: 100, next: null };
  const cur = LEVELS[idx];
  const next = LEVELS[idx + 1];
  const curThreshold = cur.tier === 0 ? 0 : Math.pow(10, cur.tier);
  const nextThreshold = Math.pow(10, next.tier);
  const pct = Math.max(
    0,
    Math.min(
      100,
      ((state.peakEarnings - curThreshold) / (nextThreshold - curThreshold)) *
        100,
    ),
  );
  return { idx, pct, next };
}

// promote the player in-order when peak earnings cross the next tier
function checkPromotion() {
  const idx = currentLevelIndex();
  if (idx > state.level) {
    state.level = idx;
    const title = LEVELS[idx].title;
    flashStatus("Promoted to " + title + "!");
    pushNews(
      "{NAME} promotes you to " + title + ". Corner office awaits.",
      "good",
    );
  }
}

function buy(gen) {
  const cost = generatorCost(gen);
  if (state.currency < cost) return;
  state.currency -= cost;
  state.owned[gen.id] = (state.owned[gen.id] || 0) + 1;
  pushNews("{NAME} quietly spins up another " + gen.name + ".", "");
  renderShop();
  render();
}

// combined multiplier for an effect key across all owned upgrades (multiplicative)
function upgMult(key) {
  let m = 1;
  for (const u of UPGRADES) {
    if (state.upgrades[u.id] && u.effect && u.effect[key] != null)
      m *= u.effect[key];
  }
  return m;
}

function buyUpgrade(up) {
  // consumables can be re-bought once spent; permanent upgrades only once
  const depleted = !!up.charges && state.secretaryCharges <= 0;
  if (state.upgrades[up.id] && !depleted) return; // already owned
  if (state.currency < up.cost) return;
  state.currency -= up.cost;
  state.upgrades[up.id] = true;
  if (up.charges) state.secretaryCharges = up.charges;
  renderUpgrades();
  render();
  flashStatus("Acquired: " + up.name);
  pushNews("{NAME} adopts " + up.name + "; board calls it 'prudent'.", "");
}

function addEarnings(amount) {
  state.currency += amount;
  state.suspicion += amount * TUNING.heatPerEarning;
  if (state.currency > state.peakEarnings) state.peakEarnings = state.currency;
}

function click(ev) {
  if (raidActive) return;
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
  if (state.suspicion >= 100) {
    // Secretary auto-shreds before the SEC shows up, while charges remain
    if (state.secretaryCharges > 0) {
      state.secretaryCharges--;
      state.suspicion = 10;
      renderUpgrades();
      flashStatus(
        "Secretary shredded everything. Heat → 10%. " +
          state.secretaryCharges +
          " use(s) left.",
      );
      return;
    }
    triggerInvestigation();
  }
}

// while an SEC raid modal is up (pre "lawyer up"), freeze earnings + heat
let raidActive = false;
function triggerInvestigation() {
  state.investigations++;
  if (state.investigations >= MAX_INVESTIGATIONS) {
    gameOver();
    return;
  }
  raidActive = true;
  // repeat offenses bite harder
  const lossFrac = Math.min(
    0.85,
    (TUNING.investigationLoss + state.investigations * 0.05) *
      upgMult("lossMult"),
  );
  const seized = state.currency * lossFrac;
  state.currency -= seized;
  state.suspicion = TUNING.investigationReset;
  pushNews(
    "SEC RAIDS {NAME}! " + format(seized) + " in 'earnings' seized.",
    "breaking",
  );
  showModal(
    "SEC INVESTIGATION #" + state.investigations,
    "The feds froze the books. <b>" +
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
  if (raidActive) return;
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
  // raid modal up: freeze earnings + heat
  if (!raidActive) {
    addEarnings(totalCps() * upgMult("earnMult") * dt);
    state.suspicion += heatRate() * dt;
    clampHeat();
  }
  newsTick();
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
    state.revealedGens = data.revealedGens || {};
    state.revealedUpgrades = data.revealedUpgrades || {};
    // migrate older saves: anything already owned must have been affordable
    for (const gen of GENERATORS)
      if (state.owned[gen.id] > 0) state.revealedGens[gen.id] = true;
    for (const up of UPGRADES)
      if (state.upgrades[up.id]) state.revealedUpgrades[up.id] = true;
    state.level = currentLevelIndex(); // baseline from saved peak earnings
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
    flashStatus("Booked " + format(earned) + " in 'profits' while away");
  }
}

// wipe the current run (no confirm, no score). Caller handles score + UI.
function hardReset() {
  localStorage.removeItem(SAVE_KEY);
  state.currency = 0;
  state.perClick = 1000;
  state.owned = {};
  state.upgrades = {};
  state.suspicion = 0;
  state.investigations = 0;
  state.peakEarnings = 0;
  state.secretaryCharges = 0;
  state.level = 0;
  state.revealedGens = {};
  state.revealedUpgrades = {};
  state.company = null;
  news.lastHeatBucket = 0;
  news.lastDown = null;
  news.lastTier = 0;
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
  pushNews("FBI RAIDS " + name + " — executives perp-walked.", "breaking");
  recordScore(); // logs final peak under current company
  hardReset();
  showModal(
    "GAME OVER — FEDERAL RAID",
    "After <b>" +
      MAX_INVESTIGATIONS +
      " SEC investigations</b>, the FBI raided " +
      name +
      ". Assets frozen, books subpoenaed, you're doing a perp walk. " +
      "The company is finished. Your high score has been saved.",
  );
}

// forced bankruptcy when the stock collapses
function delist() {
  const name = state.company ? state.company.name : "Your shell";
  const sym = state.company ? state.company.ticker : "BIGB";
  pushNews(
    sym + " DELISTED from NASDAQ at $0.26 — shares worthless.",
    "breaking",
  );
  recordScore();
  hardReset();
  showModal(
    "DELISTED — STOCK HITS $0.26",
    "<b>" +
      sym +
      "</b> cratered to $0.26 and was kicked off the NASDAQ. " +
      name +
      " is worthless, employee 401(k)s are vaporized, and the press " +
      "smells blood. Game over. Your high score has been saved.",
  );
}

// ---- Company setup ----
function applyCompany() {
  if (!state.company) return;
  document.getElementById("tickerSym").textContent = state.company.ticker;
  const taskTitle = document.getElementById("taskTitle");
  if (taskTitle)
    taskTitle.textContent = state.company.name + " Profit Maximizer";
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
  pushNews(
    name + " (" + ticker + ") files for IPO at $" + IPO_PRICE + ".",
    "good",
  );
  if (!state.employee) showBadgeSetup();
}

// ---- Employee ID Badge ----
// grey silhouette used when the player has no camera / declines to use one
const BADGE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>" +
      "<rect width='220' height='220' fill='#9a9a9a'/>" +
      "<circle cx='110' cy='84' r='46' fill='#d0d0d0'/>" +
      "<rect x='38' y='142' width='144' height='90' rx='34' fill='#d0d0d0'/>" +
      "</svg>",
  );

let badgeStream = null; // active getUserMedia stream, while the modal is open
let badgePendingPhoto = null; // grayscale dataURL staged before "Print Badge"

function showBadgeSetup() {
  const modal = document.getElementById("badgeModal");
  const nameIn = document.getElementById("employeeNameInput");
  const err = document.getElementById("badgeErr");
  nameIn.value = state.employee ? state.employee.name : "";
  err.textContent = "";
  badgePendingPhoto = state.employee ? state.employee.photo : null;
  updateBadgePreview();
  modal.classList.remove("hidden");
  startBadgeCamera();
  nameIn.focus();
}

function closeBadgeModal() {
  stopBadgeCamera();
  document.getElementById("badgeModal").classList.add("hidden");
}

function startBadgeCamera() {
  const video = document.getElementById("badgeVideo");
  const err = document.getElementById("badgeErr");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    err.textContent = "Camera not available here — use 'No Camera' instead.";
    return;
  }
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "user" }, audio: false })
    .then((stream) => {
      badgeStream = stream;
      video.srcObject = stream;
      if (!badgePendingPhoto) updateBadgePreview();
    })
    .catch(() => {
      err.textContent =
        "Camera permission denied or unavailable — use 'No Camera' instead.";
    });
}

function stopBadgeCamera() {
  if (badgeStream) {
    badgeStream.getTracks().forEach((t) => t.stop());
    badgeStream = null;
  }
  document.getElementById("badgeVideo").srcObject = null;
}

// crop the live video to a square, downscale, and desaturate to grayscale
function grayscaleFrame(video, size) {
  const canvas = document.getElementById("badgeCanvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const vw = video.videoWidth,
    vh = video.videoHeight;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2,
    sy = (vh - side) / 2;
  ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = d[i + 1] = d[i + 2] = gray;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function captureBadgePhoto() {
  const video = document.getElementById("badgeVideo");
  const err = document.getElementById("badgeErr");
  if (!video.videoWidth) {
    err.textContent = "Camera isn't ready yet — try again in a moment.";
    return;
  }
  err.textContent = "";
  badgePendingPhoto = grayscaleFrame(video, 220);
  updateBadgePreview();
}

function useNoCameraPhoto() {
  document.getElementById("badgeErr").textContent = "";
  badgePendingPhoto = BADGE_PLACEHOLDER;
  updateBadgePreview();
}

function retakeBadgePhoto() {
  badgePendingPhoto = null;
  updateBadgePreview();
}

function updateBadgePreview() {
  const video = document.getElementById("badgeVideo");
  const img = document.getElementById("badgePreviewImg");
  const retake = document.getElementById("badgeRetakeBtn");
  if (badgePendingPhoto) {
    img.src = badgePendingPhoto;
    img.classList.remove("hidden");
    video.classList.add("hidden");
    retake.classList.remove("hidden");
  } else {
    img.classList.add("hidden");
    retake.classList.add("hidden");
    if (badgeStream) video.classList.remove("hidden");
  }
}

function confirmBadge() {
  const name = document.getElementById("employeeNameInput").value.trim();
  const err = document.getElementById("badgeErr");
  if (name.length < 2) {
    err.textContent = "Enter your name for the badge.";
    return;
  }
  if (!badgePendingPhoto) {
    err.textContent = "Capture a photo or choose 'No Camera'.";
    return;
  }
  state.employee = { name, photo: badgePendingPhoto };
  closeBadgeModal();
  render();
  save();
  flashStatus("ID badge printed for " + name + ".");
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
      <span class="score">${format(s.score)}</span>
      <span class="meta">▲ ${s.investigations}</span>
    </div>`;
  });
  body.innerHTML = rows;

  tape.textContent =
    scores.map((s) => `${s.sym} ${format(s.score)} ▲`).join("     ") + "     ";
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
  heatRate: document.getElementById("heatRate"),
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
  careerTitle: document.getElementById("careerTitle"),
  careerNext: document.getElementById("careerNext"),
  careerBar: document.getElementById("careerBar"),
  idBadgeBox: document.getElementById("idBadgeBox"),
  badgePhoto: document.getElementById("badgePhoto"),
  badgeCompany: document.getElementById("badgeCompany"),
  badgeName: document.getElementById("badgeName"),
  badgeTitle: document.getElementById("badgeTitle"),
};

// money formatter: "$100,000.00". Above 1e9 use compact $1.23B to keep layout sane.
function format(n) {
  n = Number(n) || 0;
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (n >= 1e9) {
    const units = ["", "", "", "B", "T", "Qa", "Qi"];
    const tier = Math.min(Math.floor(Math.log10(n) / 3), units.length - 1);
    s = "$" + (n / Math.pow(1000, tier)).toFixed(2) + units[tier];
  } else {
    s =
      "$" +
      n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  }
  return neg ? "-" + s : s;
}

function render() {
  el.currency.textContent = format(Math.floor(state.currency));
  el.cps.textContent = format(totalCps());
  const hr = heatRate();
  el.heatRate.textContent = (hr >= 0 ? "+" : "") + hr.toFixed(2) + "%";
  el.perClick.textContent = format(state.perClick);

  // career ladder
  checkPromotion();
  const prog = levelProgress();
  el.careerTitle.textContent = LEVELS[prog.idx].title;
  el.careerNext.textContent = prog.next
    ? "Next: " + prog.next.title + " at " + format(Math.pow(10, prog.next.tier))
    : "Top of the ladder";
  el.careerBar.style.width = prog.pct + "%";

  // employee ID badge
  if (state.employee) {
    el.idBadgeBox.classList.remove("hidden");
    el.badgePhoto.src = state.employee.photo;
    el.badgeName.textContent = state.employee.name;
    el.badgeCompany.textContent = state.company
      ? state.company.name + " (" + state.company.ticker + ")"
      : "—";
    el.badgeTitle.textContent = LEVELS[prog.idx].title;
  } else {
    el.idBadgeBox.classList.add("hidden");
  }

  // suspicion meter
  const pct = Math.max(0, Math.min(100, state.suspicion));
  el.suspicionBar.style.width = pct + "%";
  el.suspicionPct.textContent = Math.round(pct) + "%";
  el.suspicionBar.classList.toggle("hot", pct >= 75);

  // shred cooldown
  el.shredBtn.disabled = raidActive || Date.now() - lastShred < shredCooldown();

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
    if (affordable && !state.revealedGens[gen.id])
      state.revealedGens[gen.id] = true;
    const revealed = !!state.revealedGens[gen.id];
    node.classList.toggle("locked", !affordable);
    const costEl = node.querySelector(".cost");
    costEl.textContent = format(cost);
    costEl.classList.toggle("affordable", affordable);
    node.querySelector(".count-n").textContent = state.owned[gen.id] || 0;
    setMystery(node.querySelector(".name"), gen.name, revealed);
    setMystery(node.querySelector(".desc"), gen.desc, revealed);
    const statsEl = node.querySelector(".stats");
    if (statsEl) {
      statsEl.innerHTML = revealed ? genStatsHTML(gen) : "?????";
      statsEl.classList.toggle("mystery", !revealed);
    }
  }

  // upgrade affordability
  for (const up of UPGRADES) {
    const node = document.getElementById("upg-" + up.id);
    if (!node) continue;
    const owned = !!state.upgrades[up.id];
    const affordable = owned || state.currency >= up.cost;
    if (affordable && !state.revealedUpgrades[up.id])
      state.revealedUpgrades[up.id] = true;
    const revealed = owned || !!state.revealedUpgrades[up.id];
    node.classList.toggle("locked", !affordable);
    const costEl = node.querySelector(".cost");
    if (costEl) costEl.classList.toggle("affordable", !owned && affordable);
    setMystery(node.querySelector(".name"), up.name, revealed);
    setMystery(node.querySelector(".desc"), up.desc, revealed);
  }
}

// swap an item-info element between its real text and the "?????" mask
function setMystery(elm, text, revealed) {
  if (!elm) return;
  elm.textContent = revealed ? text : "?????";
  elm.classList.toggle("mystery", !revealed);
}

// the "+cps/s · heat" line for a generator, with heat color-coded
function genStatsHTML(gen) {
  const heatTxt =
    gen.heat >= 0
      ? `<span class="heat up">+${gen.heat}/s heat</span>`
      : `<span class="heat down">${gen.heat}/s heat (hides)</span>`;
  return `+${format(gen.cps)}/s &middot; ${heatTxt}`;
}

function renderUpgrades() {
  if (!el.upgrades) return;
  el.upgrades.innerHTML = "";
  for (const up of UPGRADES) {
    // consumables are re-buyable once their charges are spent
    const depleted = !!up.charges && state.secretaryCharges <= 0;
    const owned = !!state.upgrades[up.id] && !depleted;
    const revealed = owned || !!state.revealedUpgrades[up.id];
    const node = document.createElement("div");
    node.className = "shop-item upgrade" + (owned ? " owned" : "");
    node.id = "upg-" + up.id;
    const ownedTag = up.charges
      ? `<div class="owned-tag">${state.secretaryCharges} LEFT</div>`
      : '<div class="owned-tag">OWNED</div>';
    const mysteryCls = revealed ? "" : " mystery";
    node.innerHTML = `
      <div class="item-info">
        <div class="name${mysteryCls}">${revealed ? up.name : "?????"}</div>
        <div class="desc${mysteryCls}">${revealed ? up.desc : "?????"}</div>
      </div>
      <div class="item-buy">
        ${owned ? ownedTag : `<div class="cost">${format(up.cost)}</div>`}
      </div>`;
    if (!owned) node.addEventListener("click", () => buyUpgrade(up));
    el.upgrades.appendChild(node);
  }
}

function renderShop() {
  el.shop.innerHTML = "";
  for (const gen of GENERATORS) {
    const count = state.owned[gen.id] || 0;
    const revealed = !!state.revealedGens[gen.id];
    const mysteryCls = revealed ? "" : " mystery";
    const node = document.createElement("div");
    node.className = "shop-item";
    node.id = "item-" + gen.id;
    node.innerHTML = `
      <div class="item-info">
        <div class="name${mysteryCls}">${revealed ? gen.name : "?????"}</div>
        <div class="desc${mysteryCls}">${revealed ? gen.desc : "?????"}</div>
        <div class="stats${mysteryCls}">${revealed ? genStatsHTML(gen) : "?????"}</div>
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

// ---- News ticker ----
// Scrolls one headline at a time across the BIZWIRE bar. Headlines come from a
// reactive event queue (raids, buys, heat, stock swings) plus idle flavor.
const news = {
  queue: [], // [{ text, kind }] kind: "" | "breaking" | "good"
  running: false,
  lastHeatBucket: 0, // last heat threshold we reported (0/75)
  lastDown: null, // last known stock direction (true = ▼)
  lastTier: 0, // last reported earnings power-of-ten
};

const NEWS_IDLE = [
  "Analysts rate {SYM} a STRONG BUY.",
  "{NAME} unveils synergy-forward paradigm; share buyback rumored.",
  "CNBC: “{SYM} is the smartest company in the room.”",
  "{NAME} CFO named 'Most Innovative' for off-balance-sheet artistry.",
  "Mad Money: “BOOYAH! Back up the truck on {SYM}!”",
  "{NAME} reports record earnings for the 14th straight quarter.",
  "Pension funds pile into {SYM}; fundamentals 'irrelevant', says fund.",
  "{NAME} opens new Cayman 'satellite office' (a mailbox).",
  "Wall Street loves {SYM}: price target raised to the moon.",
  "{NAME} employees encouraged to hold {SYM} in their 401(k).",
  "Quarterly footnotes now longer than the actual report.",
  "{SYM} added to index funds; index funds now confused.",
  "{NAME} shreds Q3 documents 'for the environment'.",
  "Auditor signs off, asks no questions, bills $40M.",
];

function newsCompany() {
  return {
    sym: state.company ? state.company.ticker : "BIGB",
    name: state.company ? state.company.name : "the company",
  };
}

function newsFill(text) {
  const c = newsCompany();
  return text.replace(/\{SYM\}/g, c.sym).replace(/\{NAME\}/g, c.name);
}

// queue a headline. breaking jumps the line; everything else appends.
function pushNews(text, kind) {
  const item = { text: newsFill(text), kind: kind || "" };
  if (kind === "breaking") news.queue.unshift(item);
  else news.queue.push(item);
  if (!news.running) advanceNews();
}

function pickIdle() {
  return NEWS_IDLE[Math.floor(Math.random() * NEWS_IDLE.length)];
}

function advanceNews() {
  const tape = document.getElementById("newsTape");
  const bar = document.getElementById("newsTicker");
  const label = document.getElementById("newsLabel");
  if (!tape || !bar) return;
  if (!news.queue.length)
    news.queue.push({ text: newsFill(pickIdle()), kind: "" });
  const item = news.queue.shift();
  news.running = true;

  tape.className = "";
  tape.textContent = item.text;
  bar.classList.toggle("breaking", item.kind === "breaking");
  bar.classList.toggle("good", item.kind === "good");
  label.textContent = item.kind === "breaking" ? "BREAKING" : "NEWSMASTER";

  // scroll speed scales with length so long headlines aren't faster
  const dur = Math.max(7, item.text.length * 0.13);
  // restart animation
  void tape.offsetWidth;
  tape.style.animationDuration = dur + "s";
  tape.classList.add("run");
  if (item.kind) tape.classList.add(item.kind);
}

function onNewsEnd() {
  news.running = false;
  advanceNews();
}

// ambient reactions to game state, called each tick
function newsTick() {
  // heat warning crossing 75%
  const bucket = state.suspicion >= 75 ? 75 : 0;
  if (bucket > news.lastHeatBucket) {
    pushNews("SEC reportedly 'taking a closer look' at {NAME}.", "breaking");
  }
  news.lastHeatBucket = bucket;

  // stock direction flips
  const down = sharePrice() < IPO_PRICE;
  if (news.lastDown !== null && down !== news.lastDown) {
    if (down) pushNews("{SYM} slips below IPO price as doubts swirl.", "");
    else pushNews("{SYM} rallies past IPO price on profits!", "good");
  }
  news.lastDown = down;

  // earnings milestones (each new power of ten)
  const tier =
    state.peakEarnings >= 1 ? Math.floor(Math.log10(state.peakEarnings)) : 0;
  if (tier > news.lastTier && news.lastTier > 0) {
    pushNews(
      "{NAME} 'earnings' blow past " + format(Math.pow(10, tier)) + "!",
      "good",
    );
  }
  news.lastTier = tier;
}

// ---- Modal ----
function showModal(title, bodyHtml) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  document.getElementById("modal").classList.remove("hidden");
}
function closeModal() {
  raidActive = false; // lawyered up -> resume earnings + heat
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
  document.getElementById("badgeMenu").addEventListener("click", showBadgeSetup);
  document
    .getElementById("idBadgeBox")
    .addEventListener("click", showBadgeSetup);
  document
    .getElementById("badgeCaptureBtn")
    .addEventListener("click", captureBadgePhoto);
  document
    .getElementById("badgeRetakeBtn")
    .addEventListener("click", retakeBadgePhoto);
  document
    .getElementById("badgeSkipCamBtn")
    .addEventListener("click", useNoCameraPhoto);
  document
    .getElementById("badgeConfirmBtn")
    .addEventListener("click", confirmBadge);
  document.getElementById("badgeCloseX").addEventListener("click", closeBadgeModal);
  document
    .getElementById("employeeNameInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirmBadge();
    });
  const newsTape = document.getElementById("newsTape");
  if (newsTape) newsTape.addEventListener("animationend", onNewsEnd);
  advanceNews(); // start the ticker rolling
  tickClock();
  setInterval(tickClock, 10000);
  lastTick = Date.now();
  setInterval(tick, TICK_MS);
  setInterval(save, AUTOSAVE_MS);
  window.addEventListener("beforeunload", save);

  if (!state.company) showSetup(); // first launch -> incorporate
  else if (!state.employee) showBadgeSetup(); // migrated save missing a badge
}

init();
