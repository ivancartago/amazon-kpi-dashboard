/* Amazon Seller KPI Dashboard
 * Static app: Chart.js for charts, everything else vanilla JS.
 * Sample data ships in data/sample-data.js. Anything you upload, type in, or comment
 * is saved in this browser's localStorage only. Nothing is sent anywhere.
 */
(function () {
  "use strict";

  const SAMPLE = window.SAMPLE_DATA;
  const app = document.getElementById("app");
  const STORE_KEY = "kpi-dashboard-data-v2";

  // ---------- Formatting ----------
  const fmt = {
    money: v => (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 }),
    money2: v => (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct: v => (v * 100).toFixed(1) + "%",
    pct2: v => (v * 100).toFixed(2) + "%",
    num: v => Math.round(v).toLocaleString("en-US"),
    dec: v => v.toFixed(1),
  };
  const safeDiv = (a, b) => (b ? a / b : 0);
  const toDate = iso => new Date(iso + "T00:00:00");
  const dateLabel = iso => toDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const dateLong = iso => toDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const weekStart = iso => { const d = toDate(iso); d.setDate(d.getDate() - d.getDay()); return isoOf(d); };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const change = (cur, prev) => (prev == null || cur == null || prev === 0 ? null : (cur - prev) / Math.abs(prev));
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- Data store ----------
  // Normalized shape: weekly[pid][weekISO] = raw row; keywords/competitors rows keyed by week.
  function fromSample(s) {
    const byWeek = arr => Object.fromEntries(arr.map(r => [r.week, r]));
    return {
      version: 2,
      meta: clone(s.meta),
      products: clone(s.products),
      weekly: Object.fromEntries(Object.entries(s.weekly).map(([pid, rows]) => [pid, byWeek(rows)])),
      keywords: s.keywords.map(k => ({ product: k.product, keyword: k.keyword, rows: byWeek(k.rows) })),
      competitors: s.competitors.map(c => ({ product: c.product, category: c.category, rows: byWeek(c.rows) })),
      event: clone(s.event),
      audit: clone(s.audit),
    };
  }
  function loadDB() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const d = JSON.parse(raw); if (d && d.version === 2) return d; }
    } catch (e) { /* fall through to sample */ }
    return SAMPLE ? fromSample(SAMPLE) : null;
  }
  let DB = loadDB();
  if (!DB) { app.innerHTML = '<p class="empty">No data found. Check that data/sample-data.js is loading.</p>'; return; }
  let usingStored = !!safeGet(STORE_KEY);
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function saveDB() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); usingStored = true; return true; }
    catch (e) { toast("Couldn't save in this browser (storage is full or blocked). Download a backup from the Data tab.", true); return false; }
  }

  // ---------- Metrics ----------
  const METRICS = [
    { key: "profit", label: "Net profit", f: "money", dir: 1, def: "Sales minus Amazon fees, landed cost, ad spend, and other costs.", formula: "from your profit tool, or units × (price − fees − landed cost) − PPC spend" },
    { key: "totalSales", label: "Total sales", f: "money", dir: 1, def: "Ordered product sales, organic and paid.", formula: "business report" },
    { key: "ppcSales", label: "PPC sales", f: "money", dir: 1, def: "Sales attributed to sponsored ads.", formula: "ads report" },
    { key: "ppcSpend", label: "PPC spend", f: "money", dir: 0, def: "Sponsored ads cost for the week.", formula: "ads report" },
    { key: "pctPpc", label: "Share of sales from PPC", f: "pct", dir: 0, def: "How dependent the product is on ads. A rising share with flat sales usually means organic rank is slipping.", formula: "PPC sales ÷ total sales" },
    { key: "units", label: "Units", f: "num", dir: 1, def: "Units ordered.", formula: "business report" },
    { key: "sessions", label: "Sessions", f: "num", dir: 1, def: "Listing visits, organic and paid.", formula: "business report" },
    { key: "cvr", label: "Conversion rate (unit session %)", f: "pct", dir: 1, def: "Share of sessions that ended in an order.", formula: "units ÷ sessions" },
    { key: "orgCvr", label: "Organic CVR", f: "pct", dir: 1, def: "Conversion on non-ad traffic.", formula: "(units − PPC units) ÷ (sessions − PPC clicks)" },
    { key: "ppcCvr", label: "PPC CVR", f: "pct", dir: 1, def: "Conversion on ad clicks.", formula: "PPC units ÷ PPC clicks" },
    { key: "ctr", label: "Ad CTR", f: "pct2", dir: 1, def: "Share of ad impressions that were clicked. A drop often points to the main image, price, or a competitor's new offer.", formula: "PPC clicks ÷ impressions" },
    { key: "cpc", label: "Cost per click", f: "money2", dir: -1, def: "Average price paid per ad click.", formula: "PPC spend ÷ PPC clicks" },
    { key: "cps", label: "Ad cost per session", f: "money2", dir: -1, def: "Ad spend spread across all sessions, not just paid ones.", formula: "PPC spend ÷ sessions" },
    { key: "acos", label: "ACOS", f: "pct", dir: -1, def: "Ad cost as a share of ad-attributed sales.", formula: "PPC spend ÷ PPC sales" },
    { key: "tacos", label: "TACOS", f: "pct", dir: -1, def: "Ad cost as a share of all sales. The better measure of whether ads are building the business or renting it.", formula: "PPC spend ÷ total sales" },
    { key: "price", label: "Average sale price", f: "money2", dir: 0, def: "Average price per unit after deals and coupons.", formula: "total sales ÷ units" },
    { key: "fees", label: "Amazon fees per unit", f: "money2", dir: -1, def: "Referral plus fulfillment fees per unit.", formula: "fee preview or settlement report" },
    { key: "landed", label: "Landed cost per unit", f: "money2", dir: -1, def: "Product cost plus freight and duties to get one unit into Amazon.", formula: "purchasing records" },
    { key: "margin", label: "Unit margin before ads", f: "money2", dir: 1, def: "What each unit earns before advertising.", formula: "price − fees − landed cost" },
    { key: "cpa", label: "Blended ad cost per unit", f: "money2", dir: -1, def: "Ad spend spread across every unit sold.", formula: "PPC spend ÷ units" },
    { key: "adShare", label: "Ad cost share of margin", f: "pct", dir: -1, def: "How much of each unit's margin advertising consumes. Over 100% means ads cost more than the product earns.", formula: "blended ad cost per unit ÷ unit margin" },
    { key: "beCvr", label: "Break-even CVR", f: "pct", dir: -1, def: "The conversion rate needed for margin to cover ad cost per session. Below it, ad-driven traffic loses money.", formula: "ad cost per session ÷ unit margin" },
  ];
  const M = Object.fromEntries(METRICS.map(m => [m.key, m]));

  function derive(r) {
    const margin = r.price - r.fees - r.landed;
    const cps = safeDiv(r.ppcSpend, r.sessions), cpa = safeDiv(r.ppcSpend, r.units);
    return Object.assign({}, r, {
      pctPpc: safeDiv(r.ppcSales, r.totalSales), cvr: safeDiv(r.units, r.sessions),
      orgCvr: safeDiv(r.units - r.ppcUnits, r.sessions - r.ppcClicks), ppcCvr: safeDiv(r.ppcUnits, r.ppcClicks),
      ctr: safeDiv(r.ppcClicks, r.impressions), cpc: safeDiv(r.ppcSpend, r.ppcClicks), cps, cpa, margin,
      acos: safeDiv(r.ppcSpend, r.ppcSales), tacos: safeDiv(r.ppcSpend, r.totalSales),
      adShare: safeDiv(cpa, margin), beCvr: safeDiv(cps, margin),
    });
  }

  // ---------- Indexes rebuilt after every change ----------
  let products, P, weeks, derivedCache;
  function reindex() {
    products = DB.products;
    P = Object.fromEntries(products.map(p => [p.id, p]));
    const set = new Set();
    Object.values(DB.weekly).forEach(m => Object.keys(m).forEach(w => set.add(w)));
    weeks = [...set].sort();
    derivedCache = {};
  }
  function rowAt(pid, week) {
    if (!week || !DB.weekly[pid] || !DB.weekly[pid][week]) return null;
    const k = pid + "|" + week;
    return derivedCache[k] || (derivedCache[k] = derive(DB.weekly[pid][week]));
  }
  const prevWeekOf = w => { const i = weeks.indexOf(w); return i > 0 ? weeks[i - 1] : null; };
  const weeksUpTo = w => weeks.slice(0, weeks.indexOf(w) + 1);
  const series = (pid, key, ws) => ws.map(w => { const r = rowAt(pid, w); return r ? r[key] : null; });
  const lastKnown = (pid, before) => {
    const m = DB.weekly[pid] || {};
    const ks = Object.keys(m).filter(w => !before || w < before).sort();
    return ks.length ? m[ks[ks.length - 1]] : null;
  };
  reindex();

  // ---------- Status rules ----------
  function assess(pid, w) {
    const r = rowAt(pid, w), prev = rowAt(pid, prevWeekOf(w));
    if (!r) return { level: "none", label: "No data", flags: [] };
    if (r.profit < 0) return { level: "bad", label: "Losing money", flags: ["Net profit is negative"] };
    const flags = [];
    if (prev) {
      const pc = change(r.profit, prev.profit); if (pc !== null && pc < -0.2) flags.push(`Profit down ${fmt.pct(-pc)} week over week`);
      const cc = change(r.cvr, prev.cvr); if (cc !== null && cc < -0.15) flags.push(`Conversion down ${fmt.pct(-cc)}`);
    }
    if (r.tacos > 0.2) flags.push(`TACOS at ${fmt.pct(r.tacos)}`);
    if (r.ppcSpend > 0 && r.cvr < r.beCvr) flags.push("Conversion below break-even for ads");
    return flags.length ? { level: "watch", label: "Watch", flags } : { level: "good", label: "Healthy", flags };
  }

  // ---------- State ----------
  const state = {
    tab: "overview", week: weeks[weeks.length - 1] || null, product: products[0] && products[0].id, overviewMetric: "profit",
    kwProduct: products[0] && products[0].id, compProduct: null, auditProduct: "all", auditArea: "all", auditStatus: "all",
    pendingImport: null, formProduct: null, formWeek: null,
  };
  let charts = [];
  const destroyCharts = () => { charts.forEach(c => c.destroy()); charts = []; };

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, isError) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.className = isError ? "show err" : "show";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ""; }, 3200);
  }

  // ---------- Charts ----------
  function chartTheme() {
    if (!window.Chart) return;
    Chart.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css("--muted");
    Chart.defaults.borderColor = css("--line-soft");
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.tooltip.backgroundColor = css("--ink");
    Chart.defaults.plugins.tooltip.titleColor = css("--surface");
    Chart.defaults.plugins.tooltip.bodyColor = css("--surface");
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.spanGaps = true;
    Chart.defaults.animation = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 350 };
  }
  const seriesColor = i => css(`--series-${(i % 5) + 1}`);
  function makeChart(canvas, config) {
    if (!canvas) return;
    if (!window.Chart) { canvas.parentElement.innerHTML = '<p class="empty">Charts need an internet connection to load Chart.js.</p>'; return; }
    const c = new Chart(canvas, config); charts.push(c); return c;
  }
  const axisFmt = f => v => (f === "money" || f === "money2") ? fmt.money(v) : (f.startsWith("pct") ? (v * 100).toFixed(f === "pct2" ? 2 : 0) + "%" : fmt.num(v));
  const tipFmt = f => ctx => `${ctx.dataset.label}: ${ctx.parsed.y == null ? "–" : fmt[f](ctx.parsed.y)}`;

  // ---------- Render helpers ----------
  function deltaHTML(cur, prev, dir) {
    const c = change(cur, prev);
    if (c === null) return '<span class="delta flat">–</span>';
    const cls = Math.abs(c) < 0.005 || dir === 0 ? "flat" : (c * dir > 0 ? "up" : "down");
    return `<span class="delta ${cls}">${c > 0 ? "▲" : c < 0 ? "▼" : ""} ${fmt.pct(Math.abs(c))}</span>`;
  }
  function sparkSVG(raw) {
    const values = raw.filter(v => v != null);
    if (values.length < 2) return '<span class="pmeta">Not enough history</span>';
    const w = 160, h = 38, pad = 3, min = Math.min(0, ...values), max = Math.max(...values);
    const x = i => pad + (i * (w - 2 * pad)) / (values.length - 1);
    const y = v => h - pad - ((v - min) * (h - 2 * pad)) / (max - min || 1);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const zero = min < 0 ? `<line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" stroke="${css("--bad")}" stroke-dasharray="2 3" stroke-width="1"/>` : "";
    const last = values[values.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${zero}<polyline fill="none" stroke="${css("--ink-soft")}" stroke-width="1.6" points="${pts}"/><circle cx="${x(values.length - 1)}" cy="${y(last)}" r="2.6" fill="${last < 0 ? css("--bad") : css("--accent")}"/></svg>`;
  }
  const productOptions = (sel, list = products, withAll = false) =>
    (withAll ? `<option value="all"${sel === "all" ? " selected" : ""}>All products</option>` : "") +
    list.map(p => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("");
  const emptyState = (msg) => `<section class="section panel"><p class="empty">${msg}</p><p style="margin-top:10px"><button class="btn" data-goto="data">Go to Data</button></p></section>`;
  const bindGoto = () => app.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => go(b.dataset.goto)));

  // ---------- Overview ----------
  function viewOverview() {
    if (!weeks.length) { app.innerHTML = emptyState("No weekly numbers yet. Upload a CSV or enter a week by hand to get started."); bindGoto(); return; }
    const w = state.week, pw = prevWeekOf(w);
    const rows = products.map(p => ({ p, r: rowAt(p.id, w), prev: rowAt(p.id, pw), a: assess(p.id, w) }));
    const live = rows.filter(x => x.r);
    const tot = (k, which = "r") => live.reduce((s, x) => s + (x[which] ? x[which][k] : 0), 0);
    const hasPrev = live.some(x => x.prev);
    const counts = { good: 0, watch: 0, bad: 0, none: 0 }; rows.forEach(x => counts[x.a.level]++);

    const head = `<div class="score-head"><span></span><span>Product</span><span>Net profit</span><span>Last 12 weeks</span><span>Sessions</span><span>CVR</span><span>TACOS</span></div>`;
    const body = rows.map(({ p, r, prev, a }) => {
      if (!r) return `<button class="score-row st-none" data-go-report="${esc(p.id)}"><span class="bar"></span><span class="c-name"><span class="pname">${esc(p.name)}</span><span class="pmeta">${esc(p.sku || p.id)} · <span class="verdict">No data this week</span></span></span><span class="c-profit"><span class="big muted">–</span></span><span class="spark-cell">${sparkSVG(series(p.id, "profit", weeksUpTo(w).slice(-12)))}</span><span class="mini m1"></span><span class="mini m2"></span><span class="mini m3"></span></button>`;
      return `<button class="score-row st-${a.level}" data-go-report="${esc(p.id)}" aria-label="Open ${esc(p.name)} report">
        <span class="bar"></span>
        <span class="c-name"><span class="pname">${esc(p.name)}</span><span class="pmeta">${esc(p.sku || p.id)} · <span class="verdict">${a.label}</span>${r.note ? ' · <span title="Has a note">✎ note</span>' : ""}</span></span>
        <span class="c-profit"><span class="big${r.profit < 0 ? " neg" : ""}">${fmt.money(r.profit)}</span>${prev ? deltaHTML(r.profit, prev.profit, 1) : ""}</span>
        <span class="spark-cell">${sparkSVG(series(p.id, "profit", weeksUpTo(w).slice(-12)))}</span>
        <span class="mini m1" data-label="Sessions"><span class="cell-num">${fmt.num(r.sessions)}</span>${prev ? deltaHTML(r.sessions, prev.sessions, 1) : ""}</span>
        <span class="mini m2" data-label="CVR"><span class="cell-num">${fmt.pct(r.cvr)}</span>${prev ? deltaHTML(r.cvr, prev.cvr, 1) : ""}</span>
        <span class="mini m3" data-label="TACOS"><span class="cell-num">${fmt.pct(r.tacos)}</span>${prev ? deltaHTML(r.tacos, prev.tacos, -1) : ""}</span>
      </button>`;
    }).join("");

    const notes = live.filter(x => x.r.note).map(x => `<li><time>${esc(x.p.short || x.p.name)}</time><span>${esc(x.r.note)}</span></li>`).join("");
    const flags = live.filter(x => x.a.flags.length).map(x => `<li><time>${esc(x.p.short || x.p.name)}</time><span>${x.a.flags.map(esc).join("; ")}</span></li>`).join("");
    const tacosNow = safeDiv(tot("ppcSpend"), tot("totalSales")), tacosPrev = safeDiv(tot("ppcSpend", "prev"), tot("totalSales", "prev"));
    const stat = (label, v, k, dir, f) => `<div><div class="k">${label}</div><div class="v">${f(v)}</div>${hasPrev ? deltaHTML(v, k, dir) : ""}</div>`;
    const summaryBits = [`${counts.good} healthy`, `${counts.watch} to watch`, `${counts.bad} losing money`].concat(counts.none ? [`${counts.none} with no data`] : []);
    const choices = ["profit", "totalSales", "sessions", "cvr", "tacos"];
    const ws = weeksUpTo(w);

    app.innerHTML = `
      <section class="section">
        <div class="section-head">
          <h2>Portfolio for the week of ${dateLong(w)}</h2>
          <p>${summaryBits.join(", ")}. Select a product to open its report.</p>
        </div>
        <div class="stats" style="margin-bottom:14px">
          ${stat("Net profit", tot("profit"), tot("profit", "prev"), 1, fmt.money)}
          ${stat("Total sales", tot("totalSales"), tot("totalSales", "prev"), 1, fmt.money)}
          ${stat("Units", tot("units"), tot("units", "prev"), 1, fmt.num)}
          ${stat("Portfolio TACOS", tacosNow, tacosPrev, -1, fmt.pct)}
        </div>
        <div class="scoreboard">${head}${body}</div>
      </section>
      <section class="section grid-2">
        <div class="panel"><h3 style="margin-bottom:8px">Notes this week</h3>${notes ? `<ul class="notes">${notes}</ul>` : '<p class="empty">No notes for this week. Add one from a product report.</p>'}</div>
        <div class="panel"><h3 style="margin-bottom:8px">Needs attention</h3>${flags ? `<ul class="notes">${flags}</ul>` : '<p class="empty">Nothing flagged. Every product is within its thresholds.</p>'}</div>
      </section>
      <section class="section panel">
        <div class="section-head">
          <h3>Trend by product</h3>
          <div class="seg" role="group" aria-label="Chart metric">${choices.map(k => `<button data-ov-metric="${k}" aria-pressed="${state.overviewMetric === k}">${M[k].label.replace(" (unit session %)", "")}</button>`).join("")}</div>
        </div>
        <div class="chart-box"><canvas id="ov-chart" aria-label="Weekly trend chart"></canvas></div>
      </section>`;

    const m = M[state.overviewMetric];
    makeChart(document.getElementById("ov-chart"), {
      type: "line",
      data: { labels: ws.map(dateLabel), datasets: products.map((p, k) => ({ label: p.short || p.name, data: series(p.id, m.key, ws), borderColor: seriesColor(k), backgroundColor: seriesColor(k), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25 })) },
      options: { interaction: { mode: "index", intersect: false }, scales: { y: { ticks: { callback: axisFmt(m.f) } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } }, plugins: { tooltip: { callbacks: { label: tipFmt(m.f) } } } },
    });
    app.querySelectorAll("[data-go-report]").forEach(b => b.addEventListener("click", () => { state.product = b.dataset.goReport; go("report"); }));
    app.querySelectorAll("[data-ov-metric]").forEach(b => b.addEventListener("click", () => { state.overviewMetric = b.dataset.ovMetric; render(); }));
  }

  // ---------- Product report ----------
  function buildSummary(pid, w) {
    const r = rowAt(pid, w), prev = rowAt(pid, prevWeekOf(w)), a = assess(pid, w);
    const drivers = [], steps = [];
    if (prev) {
      ["sessions", "cvr", "ctr", "cpc", "price", "landed", "ppcSpend", "tacos"]
        .map(k => ({ k, c: change(r[k], prev[k]) })).filter(x => x.c !== null && Math.abs(x.c) >= 0.08)
        .sort((x, y) => Math.abs(y.c) - Math.abs(x.c)).slice(0, 4)
        .forEach(({ k, c }) => { const m = M[k]; drivers.push(`${m.label} ${c > 0 ? "up" : "down"} ${fmt.pct(Math.abs(c))} (${fmt[m.f](prev[k])} → ${fmt[m.f](r[k])})`); });
      if (!drivers.length) drivers.push("No metric moved more than 8% from last week.");
      const cv = change(r.cvr, prev.cvr), se = change(r.sessions, prev.sessions), ct = change(r.ctr, prev.ctr), lc = change(r.landed, prev.landed), pr = change(r.price, prev.price);
      if (lc !== null && lc > 0.05) steps.push(`Landed cost rose ${fmt.pct(lc)}. Unit margin is now ${fmt.money2(r.margin)}; review supplier pricing or test a price increase.`);
      if (r.profit < 0 && pr !== null && pr < -0.1) steps.push(`The ${fmt.pct(-pr)} price cut pushed the product into a loss. Set a minimum deal price that keeps margin above ad cost per unit (${fmt.money2(r.cpa)}).`);
      if (cv !== null && se !== null && cv < -0.1 && se > 0.2) steps.push("Traffic grew but converted worse, which usually means lower-intent deal or broad-match traffic. Check the search term report for clicks with no orders.");
      if (ct !== null && ct < -0.15) steps.push("Ad CTR dropped. Compare the main image, price, and badges against the top 3 results for the main keyword.");
      if (cv !== null && cv < -0.15 && !(se !== null && se > 0.2)) steps.push(`Conversion fell ${fmt.pct(-cv)} without a traffic surge to explain it. Check price and coupon against the top competitors, new reviews, and whether the listing lost a badge or the Buy Box.`);
    } else drivers.push("No previous week to compare against yet.");
    if (r.ppcSpend > 0 && r.cvr < r.beCvr) steps.push(`Conversion (${fmt.pct(r.cvr)}) is below break-even for ads (${fmt.pct(r.beCvr)}). Lower bids or pause the least efficient targets until CVR recovers.`);
    if (r.tacos > 0.2) steps.push(`TACOS is ${fmt.pct(r.tacos)}. Move budget from low-converting terms to the ones with the best ACOS.`);
    if (!steps.length) steps.push(a.level === "watch" ? "Profit is down but no single cause stands out. Hold bids steady and check again next week before changing anything." : "No changes needed. Keep current bids and budgets and review again next week.");
    return { a, drivers, steps };
  }

  function viewReport() {
    if (!weeks.length || !products.length) { app.innerHTML = emptyState("No weekly numbers yet."); bindGoto(); return; }
    const w = state.week, pid = P[state.product] ? state.product : products[0].id, p = P[pid];
    state.product = pid;
    const r = rowAt(pid, w), prev = rowAt(pid, prevWeekOf(w));
    const head = `<div class="section-head">
        <div class="controls"><label>Product <select id="rp-product">${productOptions(pid)}</select></label></div>
        <p>${esc(p.sku || p.id)} · week of ${dateLong(w)}</p></div>`;
    if (!r) {
      app.innerHTML = `<section class="section">${head}<div class="panel"><p class="empty">No numbers for ${esc(p.name)} in the week of ${dateLong(w)}.</p><p style="margin-top:10px"><button class="btn" id="rp-add">Enter this week's numbers</button></p></div></section>`;
      document.getElementById("rp-product").addEventListener("change", e => { state.product = e.target.value; render(); });
      document.getElementById("rp-add").addEventListener("click", () => { state.formProduct = pid; state.formWeek = w; go("data"); });
      return;
    }
    const ws = weeksUpTo(w), recent = ws.slice(-8).map(x => rowAt(pid, x)).filter(Boolean);
    const avg = k => recent.reduce((s, x) => s + x[k], 0) / recent.length;
    const { a, drivers, steps } = buildSummary(pid, w);
    const order = ["profit", "totalSales", "units", "sessions", "cvr", "orgCvr", "ppcCvr", "ctr", "cpc", "ppcSpend", "ppcSales", "pctPpc", "acos", "tacos", "price", "fees", "landed", "margin", "cpa", "adShare", "beCvr"];
    const table = order.map(k => { const m = M[k]; return `<tr><td><span class="metric-name">${m.label}</span></td><td class="num">${fmt[m.f](r[k])}</td><td class="num">${prev ? fmt[m.f](prev[k]) : "–"}</td><td class="num">${prev ? deltaHTML(r[k], prev[k], m.dir) : "–"}</td><td class="num">${fmt[m.f](avg(k))}</td></tr>`; }).join("");
    const log = ws.filter(x => DB.weekly[pid][x] && DB.weekly[pid][x].note).reverse().map(x => `<li><time>${dateLabel(x)}</time><span>${esc(DB.weekly[pid][x].note)}</span></li>`).join("");

    app.innerHTML = `
      <section class="section">
        ${head}
        <div class="panel summary st-${a.level}">
          <h3>${esc(p.name)} <span class="pill ${a.level}">${a.label}</span></h3>
          <p>Net profit ${fmt.money(r.profit)} on ${fmt.num(r.units)} units and ${fmt.money(r.totalSales)} in sales${prev ? `, ${r.profit >= prev.profit ? "up" : "down"} from ${fmt.money(prev.profit)} last week` : ""}.</p>
          <p class="label">What moved</p><ul>${drivers.map(d => `<li>${esc(d)}</li>`).join("")}</ul>
          <p class="label">Next steps</p><ul>${steps.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
        </div>
      </section>
      <section class="section panel">
        <label for="rp-note"><h3 style="margin-bottom:6px">Note for the week of ${dateLong(w)}</h3></label>
        <p class="hint" style="margin-bottom:8px">What happened and why: deals, price changes, stock issues, tests. Notes show on the overview and in the event log.</p>
        <textarea id="rp-note" rows="3" placeholder="e.g. Lightning Deal Tue–Thu; sessions doubled but lower-quality traffic">${esc(r.note || "")}</textarea>
        <div class="controls" style="margin-top:8px"><button class="btn primary" id="rp-save-note">Save note</button><button class="btn" id="rp-edit">Edit this week's numbers</button></div>
      </section>
      <section class="section grid-2">
        <div class="panel"><h3 style="margin-bottom:10px">Net profit and TACOS</h3><div class="chart-box"><canvas id="rp-profit"></canvas></div></div>
        <div class="panel"><h3 style="margin-bottom:10px">Conversion against break-even</h3><div class="chart-box"><canvas id="rp-cvr"></canvas></div></div>
      </section>
      <section class="section grid-2">
        <div class="panel"><h3 style="margin-bottom:6px">All metrics</h3><div class="table-wrap"><table>
          <thead><tr><th>Metric</th><th class="num">This week</th><th class="num">Last week</th><th class="num">Change</th><th class="num">8-week avg</th></tr></thead><tbody>${table}</tbody></table></div></div>
        <div class="panel"><h3 style="margin-bottom:6px">Event log</h3>${log ? `<ul class="notes">${log}</ul>` : '<p class="empty">No notes yet.</p>'}</div>
      </section>`;

    const profits = series(pid, "profit", ws);
    makeChart(document.getElementById("rp-profit"), {
      data: { labels: ws.map(dateLabel), datasets: [
        { type: "bar", label: "Net profit", data: profits, backgroundColor: profits.map(v => v != null && v < 0 ? css("--bad") : css("--series-1")), yAxisID: "y", borderRadius: 2 },
        { type: "line", label: "TACOS", data: series(pid, "tacos", ws), borderColor: css("--accent"), backgroundColor: css("--accent"), yAxisID: "y1", pointRadius: 0, borderWidth: 2, tension: 0.25 },
      ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { y: { ticks: { callback: axisFmt("money") } }, y1: { position: "right", beginAtZero: true, grid: { display: false }, ticks: { callback: axisFmt("pct") } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } },
        plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y == null ? "–" : ctx.dataset.yAxisID === "y1" ? fmt.pct(ctx.parsed.y) : fmt.money(ctx.parsed.y)}` } } } },
    });
    makeChart(document.getElementById("rp-cvr"), {
      type: "line",
      data: { labels: ws.map(dateLabel), datasets: [
        { label: "Conversion rate", data: series(pid, "cvr", ws), borderColor: css("--series-3"), backgroundColor: css("--series-3"), borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: "Break-even CVR", data: series(pid, "beCvr", ws), borderColor: css("--bad"), backgroundColor: css("--bad"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
      ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, ticks: { callback: axisFmt("pct") } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } }, plugins: { tooltip: { callbacks: { label: tipFmt("pct") } } } },
    });

    document.getElementById("rp-product").addEventListener("change", e => { state.product = e.target.value; render(); });
    document.getElementById("rp-save-note").addEventListener("click", () => {
      DB.weekly[pid][w].note = document.getElementById("rp-note").value.trim(); derivedCache = {};
      if (saveDB()) { toast("Note saved"); render(); }
    });
    document.getElementById("rp-edit").addEventListener("click", () => { state.formProduct = pid; state.formWeek = w; go("data"); });
  }

  // ---------- Keywords ----------
  function viewKeywords() {
    const withKw = products.filter(p => DB.keywords.some(k => k.product === p.id));
    if (!withKw.length) { app.innerHTML = emptyState("No keyword data yet. Upload a keyword CSV from the Data tab."); bindGoto(); return; }
    if (!withKw.some(p => p.id === state.kwProduct)) state.kwProduct = withKw[0].id;
    const list = DB.keywords.filter(k => k.product === state.kwProduct).map(k => ({ keyword: k.keyword, rows: Object.values(k.rows).sort((a, b) => a.week < b.week ? -1 : 1) })).filter(k => k.rows.length);
    const blocks = list.map((k, n) => {
      const last = k.rows[k.rows.length - 1], winning = last.clickShare > last.impressionShare;
      return `<div class="panel">
        <div class="section-head" style="margin-bottom:6px"><h3>“${esc(k.keyword)}”</h3><span class="pill ${winning ? "good" : "watch"}">${winning ? "Winning more clicks than impressions" : "Losing clicks to competitors"}</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Latest week</th><th class="num">Search volume</th><th class="num">Impression share</th><th class="num">Click share</th><th class="num">CTR (us / market)</th><th class="num">CVR (us / market)</th><th class="num">Rank</th></tr></thead>
          <tbody><tr><td>${dateLabel(last.week)}</td><td class="num">${fmt.num(last.searchVolume || 0)}</td><td class="num">${fmt.pct(last.impressionShare || 0)}</td><td class="num">${fmt.pct(last.clickShare || 0)}</td><td class="num">${fmt.pct(last.asinCtr || 0)} / ${fmt.pct(last.marketCtr || 0)}</td><td class="num">${fmt.pct(last.asinCvr || 0)} / ${fmt.pct(last.marketCvr || 0)}</td><td class="num">${last.rank != null ? fmt.dec(last.rank) : "–"}</td></tr></tbody>
        </table></div>
        <div class="grid-2" style="margin-top:12px"><div class="chart-box short"><canvas id="kw-share-${n}"></canvas></div><div class="chart-box short"><canvas id="kw-rank-${n}"></canvas></div></div>
      </div>`;
    }).join('<div style="height:16px"></div>');
    app.innerHTML = `<section class="section">
        <div class="section-head"><div class="controls"><label>Product <select id="kw-product">${productOptions(state.kwProduct, withKw)}</select></label></div>
        <p>Click share above impression share means shoppers pick this listing more often than they see it.</p></div>${blocks}</section>`;
    list.forEach((k, n) => {
      const labels = k.rows.map(r => dateLabel(r.week));
      makeChart(document.getElementById(`kw-share-${n}`), { type: "line", data: { labels, datasets: [
        { label: "Impression share", data: k.rows.map(r => r.impressionShare), borderColor: css("--series-1"), backgroundColor: css("--series-1"), borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: "Click share", data: k.rows.map(r => r.clickShare), borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2, pointRadius: 0, tension: 0.25 } ] },
        options: { interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, ticks: { callback: axisFmt("pct") } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } } }, plugins: { tooltip: { callbacks: { label: tipFmt("pct") } } } } });
      makeChart(document.getElementById(`kw-rank-${n}`), { type: "line", data: { labels, datasets: [{ label: "Average organic rank", data: k.rows.map(r => r.rank), borderColor: css("--series-3"), backgroundColor: css("--series-3"), borderWidth: 2, pointRadius: 0, tension: 0.25 }] },
        options: { scales: { y: { reverse: true, title: { display: true, text: "Rank (1 = top)" } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } } } } });
    });
    document.getElementById("kw-product").addEventListener("change", e => { state.kwProduct = e.target.value; render(); });
  }

  // ---------- Competitors ----------
  function viewCompetitors() {
    const avail = DB.competitors.filter(c => P[c.product] && Object.keys(c.rows).length);
    if (!avail.length) { app.innerHTML = emptyState("No competitor data yet. Upload a competitor CSV from the Data tab."); bindGoto(); return; }
    if (!avail.some(c => c.product === state.compProduct)) state.compProduct = avail[0].product;
    const c = avail.find(x => x.product === state.compProduct);
    const rows = Object.values(c.rows).sort((a, b) => a.week < b.week ? -1 : 1), last = rows[rows.length - 1];
    const tiers = [["#1", last.top1], ["#2", last.top2], ["#3", last.top3]];
    const gapRows = tiers.map(([t, v]) => { const gap = v - last.our30dRevenue; return `<tr><td>${t} in category</td><td class="num">${fmt.money(v)}</td><td class="num">${gap > 0 ? fmt.money(gap) : "Ahead"}</td><td class="num">${gap > 0 ? fmt.pct(safeDiv(gap, last.our30dRevenue)) : "–"}</td></tr>`; }).join("");
    const next = tiers.filter(([, v]) => v > last.our30dRevenue).pop();
    const notes = rows.filter(r => r.note).map(r => `<li><time>${dateLabel(r.week)}</time><span>${esc(r.note)}</span></li>`).join("");
    app.innerHTML = `
      <section class="section">
        <div class="section-head"><div class="controls"><label>Product <select id="cp-product">${productOptions(state.compProduct, avail.map(x => P[x.product]))}</select></label></div>
          <p>Trailing 30-day revenue against the top 3 listings in the Best Sellers category, checked weekly.</p></div>
        <div class="stats">
          <div><div class="k">Category</div><div class="v" style="font-size:1.05rem">${esc(c.category || "–")}</div></div>
          <div><div class="k">Current rank</div><div class="v">#${last.rank}</div></div>
          <div><div class="k">Our 30-day revenue</div><div class="v">${fmt.money(last.our30dRevenue)}</div></div>
          <div><div class="k">${next ? `Gap to ${next[0]}` : "Position"}</div><div class="v">${next ? fmt.money(next[1] - last.our30dRevenue) : "Top of category"}</div></div>
        </div>
      </section>
      <section class="section grid-2">
        <div class="panel"><h3 style="margin-bottom:10px">30-day revenue: us vs the top 3</h3><div class="chart-box"><canvas id="cp-chart"></canvas></div></div>
        <div class="panel"><h3 style="margin-bottom:6px">Revenue needed to move up</h3>
          <div class="table-wrap"><table><thead><tr><th>Competitor</th><th class="num">30-day revenue</th><th class="num">Gap</th><th class="num">Gap vs ours</th></tr></thead><tbody>${gapRows}</tbody></table></div>
          <h3 style="margin:18px 0 6px">Notes</h3>${notes ? `<ul class="notes">${notes}</ul>` : '<p class="empty">No notes for this category.</p>'}</div>
      </section>`;
    const ds = [["Us", "our30dRevenue", css("--accent"), 3, []], ["#1", "top1", css("--series-1"), 1.5, [4, 3]], ["#2", "top2", css("--series-3"), 1.5, [4, 3]], ["#3", "top3", css("--series-4"), 1.5, [4, 3]]]
      .map(([label, key, color, bw, dash]) => ({ label, data: rows.map(r => r[key]), borderColor: color, backgroundColor: color, borderWidth: bw, borderDash: dash, pointRadius: 0, tension: 0.25 }));
    makeChart(document.getElementById("cp-chart"), { type: "line", data: { labels: rows.map(r => dateLabel(r.week)), datasets: ds },
      options: { interaction: { mode: "index", intersect: false }, scales: { y: { ticks: { callback: axisFmt("money") } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } } }, plugins: { tooltip: { callbacks: { label: tipFmt("money") } } } } });
    document.getElementById("cp-product").addEventListener("change", e => { state.compProduct = e.target.value; render(); });
  }

  // ---------- Event impact ----------
  function viewEvent() {
    const E = DB.event;
    if (!E || !E.days || !E.days.length) { app.innerHTML = '<section class="section panel"><p class="empty">No event comparison in this dataset. Reset to sample data on the Data tab to see an example.</p></section>'; return; }
    const p = P[E.product] || { name: E.product }, s = E.startIndex, before = E.days.slice(0, s), after = E.days.slice(s);
    const avg = (arr, yr, k) => arr.reduce((t, d) => t + d[yr][k], 0) / arr.length;
    const cvr = (arr, yr) => safeDiv(arr.reduce((t, d) => t + d[yr].units, 0), arr.reduce((t, d) => t + d[yr].sessions, 0));
    const lift = (a, b) => { const c = change(a, b); return c === null ? "–" : `${c >= 0 ? "+" : "−"}${fmt.pct(Math.abs(c))}`; };
    const cls = (a, b) => ((change(a, b) || 0) >= 0 ? "up" : "down");
    const rowsHTML = E.days.map(d => `<tr${d.note ? ' style="font-weight:600"' : ""}><td>${dateLabel(d.date)}${d.note ? ` <span class="pill good">${esc(d.note)}</span>` : ""}</td><td class="num">${fmt.money(d.thisYear.revenue)}</td><td class="num">${fmt.money(d.lastYear.revenue)}</td><td class="num">${fmt.num(d.thisYear.sessions)}</td><td class="num">${fmt.pct(safeDiv(d.thisYear.units, d.thisYear.sessions))}</td><td class="num">${fmt.money(d.thisYear.adCost)}</td><td class="num">${fmt.money(d.thisYear.netProfit)}</td></tr>`).join("");
    const ra = avg(after, "thisYear", "revenue"), rb = avg(before, "thisYear", "revenue"), sa = avg(after, "thisYear", "sessions"), sb = avg(before, "thisYear", "sessions");
    app.innerHTML = `
      <section class="section">
        <div class="section-head"><h2>${esc(E.title)}: ${esc(p.name)}</h2><p>Daily results before and after the event, with the same calendar days last year.</p></div>
        <div class="stats">
          <div><div class="k">Avg daily revenue after</div><div class="v">${fmt.money(ra)}</div><span class="delta ${cls(ra, rb)}">${lift(ra, rb)} vs before</span></div>
          <div><div class="k">Avg daily sessions after</div><div class="v">${fmt.num(sa)}</div><span class="delta ${cls(sa, sb)}">${lift(sa, sb)} vs before</span></div>
          <div><div class="k">Conversion after</div><div class="v">${fmt.pct(cvr(after, "thisYear"))}</div><span class="delta flat">${fmt.pct(cvr(before, "thisYear"))} before</span></div>
          <div><div class="k">Revenue vs last year</div><div class="v">${lift(avg(E.days, "thisYear", "revenue"), avg(E.days, "lastYear", "revenue"))}</div><span class="delta flat">same ${E.days.length} days</span></div>
        </div>
      </section>
      <section class="section panel"><h3 style="margin-bottom:10px">Daily revenue, this year vs last year</h3><div class="chart-box"><canvas id="ev-chart"></canvas></div></section>
      <section class="section panel"><div class="table-wrap"><table>
        <thead><tr><th>Day</th><th class="num">Revenue</th><th class="num">Revenue last year</th><th class="num">Sessions</th><th class="num">CVR</th><th class="num">Ad cost</th><th class="num">Net profit</th></tr></thead><tbody>${rowsHTML}</tbody></table></div></section>`;
    const markLine = { id: "markLine", afterDatasetsDraw(chart) {
      const x = chart.scales.x.getPixelForValue(s), { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = css("--good"); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = css("--good"); ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.fillText(E.title, x + 6, top + 12); ctx.restore(); } };
    makeChart(document.getElementById("ev-chart"), { type: "line", data: { labels: E.days.map(d => dateLabel(d.date)), datasets: [
      { label: "This year", data: E.days.map(d => d.thisYear.revenue), borderColor: css("--series-1"), backgroundColor: css("--series-1"), borderWidth: 2.5, pointRadius: 3, tension: 0.25 },
      { label: "Last year", data: E.days.map(d => d.lastYear.revenue), borderColor: css("--muted"), backgroundColor: css("--muted"), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.25 } ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, ticks: { callback: axisFmt("money") } }, x: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: tipFmt("money") } } } }, plugins: [markLine] });
  }

  // ---------- Audit ----------
  const STATUSES = ["OK", "Improve", "Issue", "Unknown", "N/A"];
  const auditCell = (it, pid) => (it.status[pid] = it.status[pid] || { status: "Unknown", priority: "", note: "" });
  function auditScore(pid) {
    const c = { OK: 0, Improve: 0, Issue: 0, Unknown: 0, "N/A": 0 };
    DB.audit.forEach(it => c[auditCell(it, pid).status]++);
    return { c, score: safeDiv(c.OK, DB.audit.length - c["N/A"]) };
  }
  function viewAudit() {
    const areas = [...new Set(DB.audit.map(a => a.area))];
    if (state.auditProduct !== "all" && !P[state.auditProduct]) state.auditProduct = "all";
    const shown = state.auditProduct === "all" ? products : [P[state.auditProduct]];
    const single = shown.length === 1;
    const scores = products.map(p => { const { c, score } = auditScore(p.id); return `<div class="audit-score"><div class="name">${esc(p.short || p.name)}</div><div class="meter"><span style="width:${(score * 100).toFixed(0)}%"></span></div><div class="counts"><strong style="color:var(--ink)">${fmt.pct(score)}</strong> complete · ${c.Issue} issues · ${c.Improve} to improve</div></div>`; }).join("");
    const matches = it => (state.auditArea === "all" || it.area === state.auditArea) && (state.auditStatus === "all" || shown.some(p => auditCell(it, p.id).status === state.auditStatus));
    let lastArea = "", body = "";
    const cols = 3 + shown.length + (single ? 1 : 0);
    DB.audit.filter(matches).forEach(it => {
      if (it.area !== lastArea) { body += `<tr class="area-row"><td colspan="${cols}">${esc(it.area)}</td></tr>`; lastArea = it.area; }
      const cells = shown.map(p => { const v = auditCell(it, p.id).status; return `<td><select class="status-select" data-v="${v}" data-item="${it.id}" data-pid="${esc(p.id)}" aria-label="${esc(p.short || p.name)}: ${esc(it.subArea)} status">${STATUSES.map(s => `<option${s === v ? " selected" : ""}>${s}</option>`).join("")}</select></td>`; }).join("");
      const noteCell = single ? `<td><input class="note-input" data-item="${it.id}" data-pid="${esc(shown[0].id)}" value="${esc(auditCell(it, shown[0].id).note)}" placeholder="Add a note" aria-label="Note for ${esc(it.subArea)}"></td>` : "";
      body += `<tr><td><span class="metric-name">${esc(it.subArea)}</span><span class="hint">${esc(it.question)}</span></td><td class="num">${it.importance}</td><td>${esc(it.kpis)}</td>${cells}${noteCell}</tr>`;
    });
    if (!body) body = `<tr><td colspan="${cols}" class="empty">No checkpoints match these filters. Clear a filter to see more.</td></tr>`;
    app.innerHTML = `
      <section class="section"><div class="section-head"><h2>Listing audit</h2><p>${DB.audit.length} checkpoints per listing. Score = OK ÷ (all checkpoints − N/A). Pick one product to add notes.</p></div><div class="audit-scores">${scores}</div></section>
      <section class="section panel">
        <div class="section-head">
          <div class="controls">
            <label>Product <select id="au-product">${productOptions(state.auditProduct, products, true)}</select></label>
            <label>Area <select id="au-area"><option value="all">All areas</option>${areas.map(a => `<option${a === state.auditArea ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></label>
            <label>Status <select id="au-status"><option value="all">Any status</option>${STATUSES.map(s => `<option${s === state.auditStatus ? " selected" : ""}>${s}</option>`).join("")}</select></label>
          </div>
          <button class="btn" id="au-export">Download CSV</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Checkpoint</th><th class="num">Weight</th><th>Affects</th>${shown.map(p => `<th>${esc(p.short || p.name)}</th>`).join("")}${single ? "<th>Notes</th>" : ""}</tr></thead>
          <tbody>${body}</tbody></table></div>
      </section>`;
    const find = id => DB.audit.find(a => a.id === id);
    app.querySelectorAll(".status-select").forEach(sel => sel.addEventListener("change", e => { const { item, pid } = e.target.dataset; auditCell(find(item), pid).status = e.target.value; saveDB(); render(); }));
    app.querySelectorAll(".note-input").forEach(inp => inp.addEventListener("change", e => { const { item, pid } = e.target.dataset; auditCell(find(item), pid).note = e.target.value.trim(); if (saveDB()) toast("Note saved"); }));
    document.getElementById("au-product").addEventListener("change", e => { state.auditProduct = e.target.value; render(); });
    document.getElementById("au-area").addEventListener("change", e => { state.auditArea = e.target.value; render(); });
    document.getElementById("au-status").addEventListener("change", e => { state.auditStatus = e.target.value; render(); });
    document.getElementById("au-export").addEventListener("click", () => {
      const head = ["Area", "Checkpoint", "Question", "Weight", "Affects"]; products.forEach(p => head.push(p.name + " status", p.name + " note"));
      const lines = [head];
      DB.audit.forEach(it => { const row = [it.area, it.subArea, it.question, it.importance, it.kpis]; products.forEach(p => { const c = auditCell(it, p.id); row.push(c.status, c.note); }); lines.push(row); });
      downloadText("listing-audit.csv", toCSV(lines), "text/csv");
    });
  }

  // ---------- CSV utilities ----------
  function parseCSV(text) {
    const rows = []; let row = [], field = "", q = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ""));
  }
  const toCSV = rows => rows.map(r => r.map(v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  function downloadText(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const normKey = h => h.trim().toLowerCase().replace(/[%()]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  function parseNum(v) {
    if (v == null) return null; let s = String(v).trim(); if (!s) return null;
    let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$,\s]/g, "");
    const pct = s.endsWith("%"); if (pct) s = s.slice(0, -1);
    const n = Number(s); if (!isFinite(n)) return NaN;
    return (neg ? -n : n) / (pct ? 100 : 1);
  }
  const parseShare = v => { const n = parseNum(v); return n == null || isNaN(n) ? n : (n > 1 ? n / 100 : n); };
  function parseDate(v) {
    if (!v) return null; let s = String(v).trim().replace(/^week( of)?\s*/i, "");
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return weekStart(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return weekStart(`${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`); }
    const d = new Date(s); return isNaN(d) ? null : weekStart(isoOf(d));
  }

  // ---------- Templates ----------
  const TEMPLATES = {
    weekly: {
      file: "weekly-kpi-template.csv",
      cols: ["week", "product_id", "product_name", "sessions", "units", "total_sales", "ppc_spend", "ppc_sales", "ppc_clicks", "ppc_units", "ppc_impressions", "amazon_fees_per_unit", "landed_cost_per_unit", "net_profit", "note"],
      required: ["week", "product_id", "sessions", "units", "total_sales", "ppc_spend"],
    },
    keywords: {
      file: "keyword-share-template.csv",
      cols: ["week", "product_id", "keyword", "search_volume", "impression_share", "click_share", "market_ctr", "our_ctr", "market_cvr", "our_cvr", "rank"],
      required: ["week", "product_id", "keyword"],
    },
    competitors: {
      file: "competitor-gap-template.csv",
      cols: ["week", "product_id", "category", "our_rank", "our_30d_revenue", "top1_revenue", "top2_revenue", "top3_revenue", "note"],
      required: ["week", "product_id", "our_30d_revenue", "top1_revenue", "top2_revenue", "top3_revenue"],
    },
  };
  function templateCSV(type) {
    const t = TEMPLATES[type];
    const pool = type === "weekly" ? weeks : [].concat(...(type === "keywords" ? DB.keywords : DB.competitors).map(x => Object.keys(x.rows)));
    const latest = pool.slice().sort().pop();
    const next = latest ? addDays(latest, 7) : weekStart(isoOf(new Date()));
    const rows = [t.cols];
    if (type === "weekly") products.forEach(p => rows.push(t.cols.map(c => c === "week" ? next : c === "product_id" ? p.id : c === "product_name" ? p.name : "")));
    if (type === "keywords") DB.keywords.forEach(k => rows.push(t.cols.map(c => c === "week" ? next : c === "product_id" ? k.product : c === "keyword" ? k.keyword : "")));
    if (type === "competitors") DB.competitors.forEach(k => rows.push(t.cols.map(c => c === "week" ? next : c === "product_id" ? k.product : c === "category" ? k.category : "")));
    return toCSV(rows);
  }
  function historyCSV() {
    const cols = TEMPLATES.weekly.cols, rows = [cols];
    weeks.forEach(w => products.forEach(p => { const r = DB.weekly[p.id] && DB.weekly[p.id][w]; if (!r) return;
      rows.push([w, p.id, p.name, r.sessions, r.units, r.totalSales, r.ppcSpend, r.ppcSales, r.ppcClicks, r.ppcUnits, r.impressions, r.fees, r.landed, r.profit, r.note || ""]); }));
    return toCSV(rows);
  }

  // ---------- Import ----------
  function findProduct(idOrName) {
    const s = String(idOrName || "").trim().toLowerCase();
    return products.find(p => p.id.toLowerCase() === s || p.name.toLowerCase() === s || (p.short || "").toLowerCase() === s);
  }
  const slug = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  function analyzeCSV(text, fileName) {
    const grid = parseCSV(text);
    if (grid.length < 2) return { error: "The file has no data rows. Add at least one row under the header." };
    const header = grid[0].map(normKey);
    const alias = { date: "week", week_start: "week", product: "product_id", sku: "product_id", impressions: "ppc_impressions", ad_spend: "ppc_spend", profit: "net_profit", notes: "note", comment: "note", comments: "note", asin_ctr: "our_ctr", asin_cvr: "our_cvr" };
    const keys = header.map(h => alias[h] || h);
    const type = keys.includes("keyword") ? "keywords" : keys.includes("our_30d_revenue") ? "competitors" : keys.includes("sessions") ? "weekly" : null;
    if (!type) return { error: "Couldn't tell what this file is. Use one of the templates: the header row must include sessions (weekly numbers), keyword (keyword share), or our_30d_revenue (competitor gap)." };
    const missing = TEMPLATES[type].required.filter(k => !keys.includes(k));
    if (missing.length) return { error: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the expected header.` };

    const out = { type, fileName, items: [], errors: [], warnings: [], newProducts: [], skipped: 0 };
    const newProd = {};
    grid.slice(1).forEach((cells, i) => {
      const line = i + 2, o = {}; keys.forEach((k, j) => { o[k] = (cells[j] || "").trim(); });
      const numericCols = TEMPLATES[type].cols.filter(c => !["week", "product_id", "product_name", "keyword", "category", "note"].includes(c));
      if (numericCols.every(c => !o[c])) { out.skipped++; return; }   // blank template row
      const week = parseDate(o.week);
      if (!week) { out.errors.push(`Row ${line}: "${o.week}" isn't a date. Use YYYY-MM-DD or MM/DD/YYYY.`); return; }
      let prod = findProduct(o.product_id);
      if (!prod) {
        if (type === "weekly" && o.product_name) {
          const id = slug(o.product_id || o.product_name);
          prod = newProd[id] || (newProd[id] = { id, name: o.product_name, short: o.product_name, sku: o.product_id });
        } else { out.errors.push(`Row ${line}: unknown product "${o.product_id}". Use an existing product ID, or add a product_name column to create a new one.`); return; }
      }
      if (type === "weekly") {
        const n = k => parseNum(o[k]);
        const bad = ["sessions", "units", "total_sales", "ppc_spend", "ppc_sales", "ppc_clicks", "ppc_units", "ppc_impressions", "amazon_fees_per_unit", "landed_cost_per_unit", "net_profit"].filter(k => o[k] && isNaN(n(k)));
        if (bad.length) { out.errors.push(`Row ${line}: not a number in ${bad.join(", ")}.`); return; }
        const req = ["sessions", "units", "total_sales", "ppc_spend"].filter(k => n(k) == null);
        if (req.length) { out.errors.push(`Row ${line}: ${prod.name} is missing ${req.join(", ")}.`); return; }
        const prior = lastKnown(prod.id, week);
        const units = n("units"), total = n("total_sales");
        let fees = n("amazon_fees_per_unit"), landed = n("landed_cost_per_unit");
        if (fees == null) { if (prior) { fees = prior.fees; out.warnings.push(`Row ${line}: fees per unit carried over from the previous week (${fmt.money2(fees)}).`); } else { out.errors.push(`Row ${line}: amazon_fees_per_unit is needed for a product's first week.`); return; } }
        if (landed == null) { if (prior) { landed = prior.landed; out.warnings.push(`Row ${line}: landed cost carried over from the previous week (${fmt.money2(landed)}).`); } else { out.errors.push(`Row ${line}: landed_cost_per_unit is needed for a product's first week.`); return; } }
        const price = units ? total / units : (prior ? prior.price : 0);
        let profit = n("net_profit");
        if (profit == null) { profit = Math.round((units * (price - fees - landed) - n("ppc_spend")) * 100) / 100; out.warnings.push(`Row ${line}: net_profit was blank, so it was estimated (${fmt.money(profit)}) from margin minus ad spend.`); }
        out.items.push({ pid: prod.id, week, replaces: !!(DB.weekly[prod.id] && DB.weekly[prod.id][week]), row: {
          week, sessions: n("sessions"), units, totalSales: total, ppcSales: n("ppc_sales") || 0, ppcSpend: n("ppc_spend"), ppcClicks: n("ppc_clicks") || 0, ppcUnits: n("ppc_units") || 0,
          impressions: n("ppc_impressions") || 0, price: Math.round(price * 100) / 100, fees, landed, profit, note: o.note || (DB.weekly[prod.id] && DB.weekly[prod.id][week] ? DB.weekly[prod.id][week].note : "") } });
      } else if (type === "keywords") {
        const kwEntry = DB.keywords.find(k => k.product === prod.id && k.keyword.toLowerCase() === o.keyword.toLowerCase());
        out.items.push({ pid: prod.id, keyword: o.keyword, week, replaces: !!(kwEntry && kwEntry.rows[week]), row: {
          week, searchVolume: parseNum(o.search_volume) || 0, marketImpressions: 0, impressionShare: parseShare(o.impression_share) || 0, clickShare: parseShare(o.click_share) || 0,
          marketCtr: parseShare(o.market_ctr) || 0, asinCtr: parseShare(o.our_ctr) || 0, marketCvr: parseShare(o.market_cvr) || 0, asinCvr: parseShare(o.our_cvr) || 0, rank: parseNum(o.rank) } });
      } else {
        const entry = DB.competitors.find(c => c.product === prod.id);
        const vals = ["our_30d_revenue", "top1_revenue", "top2_revenue", "top3_revenue"].map(k => parseNum(o[k]));
        if (vals.some(v => v == null || isNaN(v))) { out.errors.push(`Row ${line}: revenue columns must all be numbers.`); return; }
        const rank = parseNum(o.our_rank) || [vals[1], vals[2], vals[3], vals[0]].sort((a, b) => b - a).indexOf(vals[0]) + 1;
        out.items.push({ pid: prod.id, category: o.category, week, replaces: !!(entry && entry.rows[week]), row: { week, rank, our30dRevenue: vals[0], top1: vals[1], top2: vals[2], top3: vals[3], note: o.note || "" } });
      }
    });
    out.newProducts = Object.values(newProd);
    return out;
  }
  function applyImport(imp) {
    imp.newProducts.forEach(p => { if (!P[p.id]) { DB.products.push(p); DB.weekly[p.id] = {}; } });
    imp.items.forEach(it => {
      if (imp.type === "weekly") { (DB.weekly[it.pid] = DB.weekly[it.pid] || {})[it.week] = it.row; }
      else if (imp.type === "keywords") {
        let k = DB.keywords.find(x => x.product === it.pid && x.keyword.toLowerCase() === it.keyword.toLowerCase());
        if (!k) { k = { product: it.pid, keyword: it.keyword, rows: {} }; DB.keywords.push(k); }
        k.rows[it.week] = it.row;
      } else {
        let c = DB.competitors.find(x => x.product === it.pid);
        if (!c) { c = { product: it.pid, category: it.category || "", rows: {} }; DB.competitors.push(c); }
        if (it.category) c.category = it.category;
        c.rows[it.week] = it.row;
      }
    });
    reindex();
    if (imp.type === "weekly") state.week = imp.items.map(i => i.week).sort().pop();
    return saveDB();
  }

  // ---------- Data tab ----------
  const FORM_FIELDS = [
    ["sessions", "Sessions", "Business report"], ["units", "Units ordered", "Business report"], ["totalSales", "Total sales ($)", "Business report"],
    ["ppcSpend", "PPC spend ($)", "Ads report"], ["ppcSales", "PPC sales ($)", "Ads report"], ["ppcClicks", "PPC clicks", "Ads report"], ["ppcUnits", "PPC units", "Ads report"], ["impressions", "PPC impressions", "Ads report"],
    ["fees", "Amazon fees per unit ($)", "Fee preview"], ["landed", "Landed cost per unit ($)", "Purchasing"], ["profit", "Net profit ($)", "Leave blank to estimate"],
  ];
  function viewData() {
    const imp = state.pendingImport;
    const fp = P[state.formProduct] ? state.formProduct : (products[0] && products[0].id);
    const ownWeeks = fp ? Object.keys(DB.weekly[fp] || {}).sort() : [];
    const fw = state.formWeek || (ownWeeks.length ? addDays(ownWeeks[ownWeeks.length - 1], 7) : (weeks.length ? weeks[weeks.length - 1] : weekStart(isoOf(new Date()))));
    const existing = fp && DB.weekly[fp] && DB.weekly[fp][fw];
    const prior = fp ? lastKnown(fp, fw) : null;
    const val = k => existing ? existing[k] : ((k === "fees" || k === "landed") && prior ? prior[k] : "");
    const latestByProduct = products.map(p => { const ks = Object.keys(DB.weekly[p.id] || {}).sort(); return `<tr><td>${esc(p.name)}</td><td><code>${esc(p.id)}</code></td><td class="num">${ks.length}</td><td class="num">${ks.length ? dateLong(ks[ks.length - 1]) : "–"}</td></tr>`; }).join("");

    let preview = "";
    if (imp && imp.error) preview = `<div class="callout bad" role="alert"><strong>Couldn't read ${esc(imp.fileName || "that file")}.</strong> ${esc(imp.error)}</div>`;
    else if (imp) {
      const adds = imp.items.filter(i => !i.replaces).length, reps = imp.items.length - adds;
      const label = { weekly: "weekly numbers", keywords: "keyword share", competitors: "competitor gap" }[imp.type];
      const wk = [...new Set(imp.items.map(i => i.week))].sort();
      preview = `<div class="callout ${imp.errors.length ? "watch" : "good"}" role="status">
        <p><strong>${esc(imp.fileName)}</strong>: ${label}. ${imp.items.length} row${imp.items.length === 1 ? "" : "s"} ready${wk.length ? ` for ${wk.length === 1 ? "the week of " + dateLong(wk[0]) : wk.length + " weeks (" + dateLabel(wk[0]) + " – " + dateLong(wk[wk.length - 1]) + ")"}` : ""}: ${adds} new, ${reps} replacing existing rows.${imp.skipped ? ` ${imp.skipped} blank row${imp.skipped === 1 ? "" : "s"} skipped.` : ""}</p>
        ${imp.newProducts.length ? `<p>New product${imp.newProducts.length > 1 ? "s" : ""} will be added: ${imp.newProducts.map(p => esc(p.name)).join(", ")}.</p>` : ""}
        ${imp.errors.length ? `<p class="label">${imp.errors.length} row${imp.errors.length === 1 ? "" : "s"} can't be imported</p><ul>${imp.errors.slice(0, 12).map(e => `<li>${esc(e)}</li>`).join("")}${imp.errors.length > 12 ? `<li>…and ${imp.errors.length - 12} more</li>` : ""}</ul>` : ""}
        ${imp.warnings.length ? `<details><summary>${imp.warnings.length} note${imp.warnings.length === 1 ? "" : "s"} about filled-in values</summary><ul>${imp.warnings.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
        <div class="controls" style="margin-top:10px">${imp.items.length ? `<button class="btn primary" id="dt-confirm">Import ${imp.items.length} row${imp.items.length === 1 ? "" : "s"}</button>` : ""}<button class="btn" id="dt-cancel">Cancel</button></div>
      </div>`;
    }

    app.innerHTML = `
      <section class="section">
        <div class="section-head"><h2>Add and manage data</h2><p>${usingStored ? "Showing your saved data." : "Showing the built-in sample data."} Everything you add is saved in this browser only. It isn't uploaded anywhere.</p></div>
        <div class="grid-2">
          <div class="panel">
            <h3>Upload a CSV</h3>
            <p class="hint" style="margin:4px 0 12px">One row per product per week. Upload a single week or your full history; rows for a week that already exists replace it.</p>
            <label class="drop" id="dt-drop">
              <input type="file" id="dt-file" accept=".csv,text/csv">
              <span><strong>Choose a CSV file</strong> or drop it here</span>
              <span class="hint">From Google Sheets: File → Download → Comma-separated values (.csv)</span>
            </label>
            ${preview}
            <p class="label" style="margin-top:16px">Templates</p>
            <p class="hint" style="margin-bottom:8px">Pre-filled with your product IDs and next week's date. Fill in the numbers and upload.</p>
            <div class="controls">
              <button class="btn" data-template="weekly">Weekly numbers</button>
              <button class="btn" data-template="keywords">Keyword share</button>
              <button class="btn" data-template="competitors">Competitor gap</button>
            </div>
          </div>
          <div class="panel">
            <h3>Enter a week by hand</h3>
            <p class="hint" style="margin:4px 0 12px">${existing ? "This week already has numbers. Saving replaces them." : "Fees and landed cost are pre-filled from the product's last week."}</p>
            <form id="dt-form" class="form-grid" novalidate>
              <label>Product<select id="f-product">${productOptions(fp)}</select></label>
              <label>Week of<input type="date" id="f-week" value="${fw}" required></label>
              ${FORM_FIELDS.map(([k, l, h]) => `<label>${l}<input type="number" step="any" inputmode="decimal" data-field="${k}" value="${val(k) === "" || val(k) == null ? "" : val(k)}" placeholder="${esc(h)}"></label>`).join("")}
              <label class="wide">Note<input type="text" data-field="note" value="${esc(existing ? existing.note : "")}" placeholder="Optional: what happened this week"></label>
              <div class="wide controls"><button type="submit" class="btn primary">${existing ? "Update week" : "Add week"}</button>${existing ? '<button type="button" class="btn danger" id="f-delete">Delete this week</button>' : ""}</div>
            </form>
          </div>
        </div>
      </section>
      <section class="section panel">
        <div class="section-head"><h3>What's loaded</h3><p>${weeks.length ? `${weeks.length} weeks, ${dateLong(weeks[0])} to ${dateLong(weeks[weeks.length - 1])}` : "No weekly data"}</p></div>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Product ID (use in CSVs)</th><th class="num">Weeks</th><th class="num">Latest week</th></tr></thead><tbody>${latestByProduct}</tbody></table></div>
      </section>
      <section class="section grid-2">
        <div class="panel">
          <h3>Back up and move your data</h3>
          <p class="hint" style="margin:4px 0 12px">Browser storage can be cleared. Download a backup after each weekly update, and restore it on another computer or browser.</p>
          <div class="controls">
            <button class="btn" id="dt-backup">Download backup</button>
            <label class="btn file-btn">Restore backup<input type="file" id="dt-restore" accept=".json,application/json"></label>
            <button class="btn" id="dt-history">Download weekly history as CSV</button>
          </div>
        </div>
        <div class="panel">
          <h3>Start over</h3>
          <p class="hint" style="margin:4px 0 12px">Replace everything with the sample data, or clear the numbers and keep your products and audit checklist.</p>
          <div class="controls">
            <button class="btn" id="dt-sample">Reset to sample data</button>
            <button class="btn danger" id="dt-empty">Clear all numbers</button>
          </div>
        </div>
      </section>`;

    // Upload
    const handleFile = file => {
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { state.pendingImport = analyzeCSV(String(rd.result), file.name); state.pendingImport.fileName = file.name; render(); };
      rd.onerror = () => { state.pendingImport = { error: "The file couldn't be read.", fileName: file.name }; render(); };
      rd.readAsText(file);
    };
    document.getElementById("dt-file").addEventListener("change", e => handleFile(e.target.files[0]));
    const drop = document.getElementById("dt-drop");
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));
    const confirm = document.getElementById("dt-confirm");
    if (confirm) confirm.addEventListener("click", () => {
      const n = imp.items.length, type = imp.type;
      if (applyImport(imp)) { state.pendingImport = null; toast(`Imported ${n} row${n === 1 ? "" : "s"}`); if (type === "weekly") go("overview"); else render(); }
    });
    const cancel = document.getElementById("dt-cancel");
    if (cancel) cancel.addEventListener("click", () => { state.pendingImport = null; render(); });
    app.querySelectorAll("[data-template]").forEach(b => b.addEventListener("click", () => { const t = b.dataset.template; downloadText(TEMPLATES[t].file, templateCSV(t), "text/csv"); }));

    // Manual form
    document.getElementById("f-product").addEventListener("change", e => { state.formProduct = e.target.value; state.formWeek = null; render(); });
    document.getElementById("f-week").addEventListener("change", e => { if (e.target.value) { state.formWeek = weekStart(e.target.value); state.formProduct = document.getElementById("f-product").value; render(); } });
    document.getElementById("dt-form").addEventListener("submit", e => {
      e.preventDefault();
      const pid = document.getElementById("f-product").value, wk = weekStart(document.getElementById("f-week").value || fw);
      const get = k => { const el = app.querySelector(`[data-field="${k}"]`); return el ? el.value.trim() : ""; };
      const missing = ["sessions", "units", "totalSales", "ppcSpend", "fees", "landed"].filter(k => get(k) === "");
      if (missing.length) { toast("Fill in sessions, units, total sales, PPC spend, fees, and landed cost.", true); return; }
      const num = k => (get(k) === "" ? 0 : Number(get(k)));
      const units = num("units"), total = num("totalSales"), price = units ? total / units : 0;
      const profit = get("profit") === "" ? Math.round((units * (price - num("fees") - num("landed")) - num("ppcSpend")) * 100) / 100 : num("profit");
      (DB.weekly[pid] = DB.weekly[pid] || {})[wk] = { week: wk, sessions: num("sessions"), units, totalSales: total, ppcSales: num("ppcSales"), ppcSpend: num("ppcSpend"), ppcClicks: num("ppcClicks"), ppcUnits: num("ppcUnits"), impressions: num("impressions"), price: Math.round(price * 100) / 100, fees: num("fees"), landed: num("landed"), profit, note: get("note") };
      reindex(); state.week = wk; state.formWeek = wk; state.formProduct = pid;
      if (saveDB()) { toast(`Saved ${P[pid].name}, week of ${dateLong(wk)}`); render(); }
    });
    const del = document.getElementById("f-delete");
    if (del) del.addEventListener("click", () => {
      if (!window.confirm(`Delete ${P[fp].name} for the week of ${dateLong(fw)}? This can't be undone unless you have a backup.`)) return;
      delete DB.weekly[fp][fw]; reindex(); if (!weeks.includes(state.week)) state.week = weeks[weeks.length - 1] || null;
      if (saveDB()) { toast("Week deleted"); render(); }
    });

    // Backup / restore / reset
    document.getElementById("dt-backup").addEventListener("click", () => downloadText(`kpi-dashboard-backup-${isoOf(new Date())}.json`, JSON.stringify(DB), "application/json"));
    document.getElementById("dt-history").addEventListener("click", () => downloadText("weekly-kpi-history.csv", historyCSV(), "text/csv"));
    document.getElementById("dt-restore").addEventListener("change", e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { const d = JSON.parse(String(rd.result)); if (!d || d.version !== 2 || !d.weekly || !d.products) throw new Error();
          DB = d; reindex(); state.week = weeks[weeks.length - 1] || null; if (saveDB()) { toast("Backup restored"); go("overview"); } }
        catch (err) { toast("That file isn't a dashboard backup. Choose a .json file downloaded from this page.", true); }
      };
      rd.readAsText(f);
    });
    document.getElementById("dt-sample").addEventListener("click", () => {
      if (!window.confirm("Replace everything in this browser with the sample data? Download a backup first if you want to keep your numbers.")) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      DB = fromSample(SAMPLE); usingStored = false; reindex(); state.week = weeks[weeks.length - 1]; toast("Sample data restored"); render();
    });
    document.getElementById("dt-empty").addEventListener("click", () => {
      if (!window.confirm("Clear all weekly, keyword, and competitor numbers? Products, notes on the audit checklist, and checklist statuses are kept.")) return;
      Object.keys(DB.weekly).forEach(k => { DB.weekly[k] = {}; });
      DB.keywords = []; DB.competitors = []; DB.event = null; reindex(); state.week = null;
      if (saveDB()) { toast("Numbers cleared. Upload a CSV to start."); render(); }
    });
  }

  // ---------- Guide ----------
  function viewGuide() {
    const colDoc = [
      ["week", "Any date in the week (YYYY-MM-DD or MM/DD/YYYY). It's moved to that week's Sunday."],
      ["product_id", "The product's ID from the Data tab. A new ID plus product_name adds a new product."],
      ["sessions, units, total_sales", "Business report, for that week."],
      ["ppc_spend, ppc_sales, ppc_clicks, ppc_units, ppc_impressions", "Sponsored ads report, for that week. Use units (not orders) if you can."],
      ["amazon_fees_per_unit, landed_cost_per_unit", "Can be left blank after the first week; the last known value is reused."],
      ["net_profit", "From your profit tool. Leave blank to estimate as units × margin − PPC spend."],
      ["note", "Optional comment for that product and week."],
    ];
    app.innerHTML = `
      <section class="section panel guide"><div class="section-head"><h2>Metric guide</h2><p>How each number is calculated from the raw weekly inputs.</p></div>
        <dl>${METRICS.map(m => `<dt>${m.label}</dt><dd>${esc(m.def)}<span class="hint">Formula: <code>${esc(m.formula)}</code></span></dd>`).join("")}</dl></section>
      <section class="section panel guide"><div class="section-head"><h2>Status rules</h2></div><dl>
        <dt><span class="pill bad">Losing money</span></dt><dd>Net profit for the week is below zero.</dd>
        <dt><span class="pill watch">Watch</span></dt><dd>Profitable, but profit fell more than 20% week over week, conversion fell more than 15%, TACOS is above 20%, or conversion is below the break-even rate for ads.</dd>
        <dt><span class="pill good">Healthy</span></dt><dd>Profitable and none of the watch conditions apply.</dd></dl></section>
      <section class="section panel guide"><div class="section-head"><h2>Weekly CSV columns</h2><p>Money without $ signs is fine; commas and $ are stripped. Percent columns accept 4.5%, 4.5, or 0.045.</p></div>
        <dl>${colDoc.map(([k, d]) => `<dt><code>${esc(k)}</code></dt><dd>${esc(d)}</dd>`).join("")}</dl></section>`;
  }

  // ---------- Routing ----------
  const VIEWS = { overview: viewOverview, report: viewReport, keywords: viewKeywords, competitors: viewCompetitors, event: viewEvent, audit: viewAudit, data: viewData, guide: viewGuide };
  const weekScoped = new Set(["overview", "report"]);
  const monthKey = w => w.slice(0, 7);
  const monthName = k => toDate(k + "-01").toLocaleDateString("en-US", { month: "long" });
  function fillWeekPicker() {
    const ms = document.getElementById("month-select"), wb = document.getElementById("week-buttons");
    if (!weeks.length) { ms.innerHTML = ""; wb.innerHTML = ""; return; }
    const cur = monthKey(state.week);
    const months = [...new Set(weeks.map(monthKey))].reverse();
    const years = [...new Set(months.map(m => m.slice(0, 4)))];
    ms.innerHTML = years.map(y => `<optgroup label="${y}">${months.filter(m => m.startsWith(y)).map(m => `<option value="${m}"${m === cur ? " selected" : ""}>${monthName(m)} ${y}</option>`).join("")}</optgroup>`).join("");
    wb.innerHTML = weeks.filter(w => monthKey(w) === cur).map(w => `<button type="button" data-week="${w}" aria-pressed="${w === state.week}" aria-label="Week of ${dateLong(w)}">${dateLabel(w)}</button>`).join("");
    wb.querySelectorAll("[data-week]").forEach(b => b.addEventListener("click", () => { state.week = b.dataset.week; render(); }));
  }
  function render() {
    destroyCharts();
    if (!weeks.includes(state.week)) state.week = weeks[weeks.length - 1] || null;
    fillWeekPicker();
    document.getElementById("brand-line").textContent = `${usingStored ? "Your data" : "Sample data"} · ${products.length} products · ${weeks.length} weeks`;
    document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    document.querySelector(".week-picker").hidden = !(weekScoped.has(state.tab) && weeks.length);
    VIEWS[state.tab]();
  }
  function go(tab) {
    state.tab = VIEWS[tab] ? tab : "overview";
    if (location.hash !== "#" + state.tab) history.replaceState(null, "", "#" + state.tab);
    render(); window.scrollTo({ top: 0 });
  }
  document.getElementById("month-select").addEventListener("change", e => {
    const inMonth = weeks.filter(w => monthKey(w) === e.target.value);
    if (inMonth.length) { state.week = inMonth[inMonth.length - 1]; render(); }
  });
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => go(b.dataset.tab)));
  window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (t !== state.tab && VIEWS[t]) { state.tab = t; render(); } });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { chartTheme(); render(); });
  chartTheme();
  go(location.hash.slice(1) || "overview");
})();
