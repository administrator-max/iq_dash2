/**
 * lib/insights.js — analytics that answer the business questions over the
 * quota dataset. Pure functions over plain row-arrays, so they work the same
 * whether the rows came from Google Sheets (sheetsStore) or Postgres (pool).
 *
 * Tables expected: { companies, cycles, cycleProducts, stats, revisions,
 *                    lots, realizations, aliases, products }
 */
const num = x => { const n = Number(x); return isNaN(n) ? 0 : n; };
const parseDMY = s => {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) { const mo = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11}[m[2].toLowerCase()]; if (mo != null) return new Date(Date.UTC(+m[3], mo, +m[1])); }
  const d = new Date(s); return isNaN(d) ? null : d;
};
const dayDiff = (a, b) => Math.round((b - a) / 86400000);

function canonMap(aliases) { const m = {}; (aliases || []).forEach(a => { m[a.alias] = a.canonical; }); return m; }
const canon = (m, p) => p ? (m[p] || p) : p;

// ── Q1: quota obtained this week / month / year ────────────────────────────
function obtainedByPeriod(t, today = new Date()) {
  const Y = today.getUTCFullYear(), M = today.getUTCMonth();
  const weekStart = new Date(today.getTime() - 6 * 86400000);
  let year = 0, month = 0, week = 0, dated = 0, pending = 0, pendingMT = 0;
  const byMonth = {};
  t.cycles.filter(c => /^obtained/i.test(c.cycle_type || '')).forEach(c => {
    const v = num(c.mt), d = parseDMY(c.release_date);
    // TBA / blank release date = not yet released → counted as PENDING, not in a period.
    if (!d) { pending += 1; pendingMT += v; return; }
    dated += 1;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = (byMonth[key] || 0) + v;
    if (d.getUTCFullYear() === Y) year += v;
    if (d.getUTCFullYear() === Y && d.getUTCMonth() === M) month += v;
    if (d >= weekStart && d <= today) week += v;
  });
  return { asOf: today.toISOString().slice(0, 10), week, month, year, byMonth, datedObtainedCycles: dated, pendingObtainedCycles: pending, pendingObtainedMT: pendingMT };
}

// ── Q2: latest document progress of a company ──────────────────────────────
function latestProgress(t, code) {
  const rows = t.cycles.filter(c => c.company_code === code)
    .slice().sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  if (!rows.length) return { company: code, found: false };
  const last = rows[rows.length - 1];
  return {
    company: code, found: true,
    lastStage: last.cycle_type, mt: num(last.mt),
    submit: { type: last.submit_type, date: last.submit_date },
    release: { type: last.release_type, date: last.release_date },
    status: last.status || '',
    timeline: rows.map(r => ({ stage: r.cycle_type, submitDate: r.submit_date, releaseDate: r.release_date, status: r.status })),
  };
}

// ── Q3: item with the most quota (obtained) ────────────────────────────────
function topQuotaItems(t, limit = 10) {
  const cm = canonMap(t.aliases);
  const cyById = {}; t.cycles.forEach(c => { cyById[String(c.id)] = c; });
  const by = {};
  t.cycleProducts.forEach(cp => {
    const cy = cyById[String(cp.cycle_id)]; if (!cy) return;
    if (!/^obtained/i.test(cy.cycle_type || '')) return;
    const p = canon(cm, cp.product); by[p] = (by[p] || 0) + num(cp.mt);
  });
  return Object.entries(by).map(([product, mt]) => ({ product, mt })).sort((a, b) => b.mt - a.mt).slice(0, limit);
}

// ── Q4: end-to-end days Submit → Obtained ──────────────────────────────────
function leadTime(t) {
  const byCo = {}; t.cycles.forEach(c => { (byCo[c.company_code] = byCo[c.company_code] || []).push(c); });
  const spans = [];
  Object.entries(byCo).forEach(([co, rows]) => {
    const subs = rows.filter(r => /^submit/i.test(r.cycle_type || ''));
    const obts = rows.filter(r => /^obtained/i.test(r.cycle_type || ''));
    subs.forEach(s => {
      const n = (String(s.cycle_type).match(/#(\d)/) || [])[1];
      const o = obts.find(x => (String(x.cycle_type).match(/#(\d)/) || [])[1] === n);
      if (!o) return;
      const sd = parseDMY(s.submit_date), od = parseDMY(o.release_date);
      if (sd && od) { const d = dayDiff(sd, od); if (d >= 0) spans.push({ company: co, cycle: n, days: d, submitDate: s.submit_date, obtainedDate: o.release_date }); }
    });
  });
  spans.sort((a, b) => a.days - b.days);
  const avg = spans.length ? spans.reduce((a, s) => a + s.days, 0) / spans.length : null;
  return { pairs: spans.length, avgDays: avg == null ? null : Math.round(avg * 10) / 10, fastest: spans[0] || null, slowest: spans[spans.length - 1] || null, detail: spans };
}

// ── Q5: remaining quota of an item ─────────────────────────────────────────
function remainingForItem(t, item) {
  const cm = canonMap(t.aliases); const want = canon(cm, item);
  let available = 0, utilization = 0; const byCompany = [];
  t.stats.forEach(s => {
    if (canon(cm, s.product) !== want) return;
    const av = num(s.available_mt), ut = num(s.utilization_mt);
    available += av; utilization += ut;
    byCompany.push({ company: s.company_code, available: av, utilization: ut });
  });
  return { item: want, remainingMT: available, utilizedMT: utilization, companies: byCompany.length, byCompany };
}

// ── Q6: which companies hold quota for an item ─────────────────────────────
function companiesWithItem(t, item) {
  const cm = canonMap(t.aliases); const want = canon(cm, item);
  const set = {};
  t.stats.forEach(s => { if (canon(cm, s.product) === want && (num(s.available_mt) + num(s.utilization_mt)) > 0) set[s.company_code] = (set[s.company_code] || 0) + num(s.available_mt) + num(s.utilization_mt); });
  return { item: want, companies: Object.entries(set).map(([company, quotaMT]) => ({ company, quotaMT })).sort((a, b) => b.quotaMT - a.quotaMT) };
}

// ── Q7: when did a company utilize ─────────────────────────────────────────
function utilizationTiming(t, code) {
  const cm = canonMap(t.aliases);
  const rows = (t.lots || []).filter(l => l.company_code === code && (l.util_date || num(l.util_mt)))
    .map(l => ({ product: canon(cm, l.product), utilMT: num(l.util_mt), date: l.util_date || '' }))
    .sort((a, b) => (parseDMY(a.date) || 0) - (parseDMY(b.date) || 0));
  return { company: code, events: rows, totalUtilizedMT: rows.reduce((a, r) => a + r.utilMT, 0) };
}

// ── Q8: what an item was last reallocated into ─────────────────────────────
function reallocations(t, item) {
  const cm = canonMap(t.aliases); const want = item ? canon(cm, item) : null;
  const byCo = {};
  t.revisions.forEach(r => {
    const p = canon(cm, r.product);
    const c = (byCo[r.company_code] = byCo[r.company_code] || { from: [], to: [] });
    c[r.direction === 'to' ? 'to' : 'from'].push({ product: p, mt: num(r.mt), label: r.label || '' });
  });
  let out = Object.entries(byCo).map(([company, o]) => ({ company, from: o.from, to: o.to }));
  if (want) out = out.filter(r => r.from.some(x => x.product === want) || r.to.some(x => x.product === want));
  return { item: want, reallocations: out };
}

// ── Realization metrics ────────────────────────────────────────────────────
function realizationMetrics(t, today = new Date()) {
  const cm = canonMap(t.aliases);
  const Y = today.getUTCFullYear(), M = today.getUTCMonth();
  const weekStart = new Date(today.getTime() - 6 * 86400000);
  let totVol = 0, year = 0, month = 0, week = 0;
  const byCompany = {}, byProduct = {};
  t.realizations.forEach(r => {
    const v = num(r.volume); totVol += v;
    byCompany[r.company_code] = (byCompany[r.company_code] || 0) + v;
    byProduct[canon(cm, r.product)] = (byProduct[canon(cm, r.product)] || 0) + v;
    const d = parseDMY(r.pib_date);
    if (d) { if (d.getUTCFullYear() === Y) year += v; if (d.getUTCFullYear() === Y && d.getUTCMonth() === M) month += v; if (d >= weekStart && d <= today) week += v; }
  });
  // realized vs obtained (companies.obtained is the granted quota)
  const vsObtained = t.companies.map(c => {
    const obtained = num(c.obtained), realized = byCompany[c.code] || 0;
    return { company: c.code, obtainedMT: obtained, realizedMT: Math.round(realized * 1000) / 1000, outstandingMT: Math.round((obtained - realized) * 1000) / 1000, realizedPct: obtained ? Math.round((realized / obtained) * 1000) / 10 : null };
  }).filter(r => r.obtainedMT || r.realizedMT);
  return {
    asOf: today.toISOString().slice(0, 10),
    totalRealizedMT: Math.round(totVol * 1000) / 1000,
    realizedThisWeekMT: Math.round(week * 1000) / 1000,
    realizedThisMonthMT: Math.round(month * 1000) / 1000,
    realizedThisYearMT: Math.round(year * 1000) / 1000,
    byProduct: Object.entries(byProduct).map(([product, mt]) => ({ product, mt: Math.round(mt * 1000) / 1000 })).sort((a, b) => b.mt - a.mt),
    vsObtained,
  };
}

function all(t, opts = {}) {
  const today = opts.today || new Date();
  const item = opts.item || 'GI ALLOY';
  const company = opts.company || (t.companies[0] && t.companies[0].code);
  return {
    q1_obtainedByPeriod: obtainedByPeriod(t, today),
    q2_latestProgress: latestProgress(t, company),
    q3_topQuotaItems: topQuotaItems(t),
    q4_leadTime: (() => { const l = leadTime(t); return { pairs: l.pairs, avgDays: l.avgDays, fastest: l.fastest, slowest: l.slowest }; })(),
    q5_remainingForItem: remainingForItem(t, item),
    q6_companiesWithItem: companiesWithItem(t, item),
    q7_utilizationTiming: utilizationTiming(t, company),
    q8_reallocations: reallocations(t, item),
    realization: realizationMetrics(t, today),
  };
}

module.exports = { obtainedByPeriod, latestProgress, topQuotaItems, leadTime, remainingForItem, companiesWithItem, utilizationTiming, reallocations, realizationMetrics, all };
