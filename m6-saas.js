/**
 * M6 — SaaS Pricing Design Studio
 * ─────────────────────────────────────────────────────────────────────────────
 * Full SaaS commercial design toolkit:
 * - Pricing metric evaluator
 * - Packaging ladder designer
 * - Van Westendorp PSM simulator
 * - ARR impact modeller
 * - Grandfathering planner
 * - Decoy tier designer
 * - FREE! impact modeller
 * - Pricing tone advisor
 *
 * No dataset required.
 */

'use strict';

const SaaSEngine = {

  /**
   * Van Westendorp Price Sensitivity Meter.
   * Four questions → four cumulative distribution curves → acceptable range.
   * tooCheap, cheap, expensive, tooExpensive: arrays of price responses
   */
  vanWestendorp(responses) {
    const { tooCheap, cheap, expensive, tooExpensive } = responses;
    const allPrices = [...tooCheap, ...cheap, ...expensive, ...tooExpensive].map(Number).filter(v => v > 0);
    if (allPrices.length === 0) return { error: 'No valid price responses' };

    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const step = (max - min) / 100;
    const points = [];

    for (let p = min; p <= max + step; p += step) {
      const pFixed = Math.round(p * 100) / 100;
      // % who say "too cheap" at price p = % of tooCheap responses >= p (cumulative from right)
      const pctTooCheap    = tooCheap.filter(v => Number(v) >= pFixed).length / tooCheap.length;
      // % who say "cheap/good value" at p = % of cheap responses >= p
      const pctCheap       = cheap.filter(v => Number(v) >= pFixed).length / cheap.length;
      // % who say "expensive" at p = % of expensive responses <= p
      const pctExpensive   = expensive.filter(v => Number(v) <= pFixed).length / expensive.length;
      // % who say "too expensive" at p = % of tooExpensive responses <= p
      const pctTooExpensive= tooExpensive.filter(v => Number(v) <= pFixed).length / tooExpensive.length;

      points.push({ price: pFixed, pctTooCheap, pctCheap, pctExpensive, pctTooExpensive });
    }

    // Intersection points
    // PMC (Point of Marginal Cheapness): tooCheap = expensive (crossing)
    // PME (Point of Marginal Expensiveness): cheap = tooExpensive (crossing)
    const pmc = this._findCrossing(points, 'pctTooCheap', 'pctExpensive');
    const pme = this._findCrossing(points, 'pctCheap', 'pctTooExpensive');
    const iap = pmc && pme ? (pmc + pme) / 2 : null; // Indifference Acceptance Point (approx)

    // OPP (Optimal Price Point): intersection of tooCheap and tooExpensive
    const opp = this._findCrossing(points, 'pctTooCheap', 'pctTooExpensive');

    return { points, pmc, pme, opp, iap, acceptableRange: { low: pmc, high: pme }, error: null };
  },

  _findCrossing(points, keyA, keyB) {
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i], next = points[i + 1];
      if ((curr[keyA] - curr[keyB]) * (next[keyA] - next[keyB]) <= 0) {
        // Linear interpolation
        const dA = (next[keyA] - curr[keyA]);
        const dB = (next[keyB] - curr[keyB]);
        const t  = (curr[keyB] - curr[keyA]) / (dA - dB);
        return curr.price + t * (next.price - curr.price);
      }
    }
    return null;
  },

  /**
   * ARR impact modeller.
   */
  arrImpact(params) {
    const { currentARR, currentPrice, newPrice, churnRate, conversionRate, existingCustomers, newCustomers } = params;
    const priceChangePct = (newPrice - currentPrice) / currentPrice;
    const isIncrease     = priceChangePct > 0;

    // Existing customers: some churn due to price increase
    const churnedCustomers    = isIncrease ? Math.round(existingCustomers * churnRate) : 0;
    const retainedCustomers   = existingCustomers - churnedCustomers;
    const existingARR         = retainedCustomers * newPrice * 12;

    // New customers: conversion affected by price
    const conversionAdj       = isIncrease ? conversionRate * (1 - Math.abs(priceChangePct) * 0.3) : conversionRate * (1 + Math.abs(priceChangePct) * 0.2);
    const convertedNew        = Math.round(newCustomers * conversionAdj);
    const newARR              = convertedNew * newPrice * 12;

    const projectedARR        = existingARR + newARR;
    const arrDelta            = projectedARR - currentARR;
    const arrDeltaPct         = currentARR > 0 ? arrDelta / currentARR : 0;

    return {
      priceChangePct,
      churnedCustomers,
      retainedCustomers,
      existingARR,
      convertedNew,
      newARR,
      projectedARR,
      arrDelta,
      arrDeltaPct,
      isIncrease
    };
  },

  /**
   * Grandfathering planner.
   * Models staged price increase rollout to existing customers.
   */
  grandfathering(params) {
    const { currentPrice, newPrice, existingCustomers, monthlyChurn, noticeMonths } = params;
    const stages = [];
    let remainingCustomers = existingCustomers;

    for (let month = 0; month <= noticeMonths + 6; month++) {
      const churned   = Math.round(remainingCustomers * monthlyChurn);
      remainingCustomers = Math.max(0, remainingCustomers - churned);
      const price     = month < noticeMonths ? currentPrice : newPrice;
      const mrr       = remainingCustomers * price;
      stages.push({ month, remainingCustomers, price, mrr, churned });
    }

    const currentRunRate = existingCustomers * currentPrice * 12;
    const finalRunRate   = stages[stages.length-1].remainingCustomers * newPrice * 12;

    return { stages, currentRunRate, finalRunRate, netArrChange: finalRunRate - currentRunRate };
  },

  /**
   * FREE! impact modeller.
   * Quantifies the conversion rate required to justify a free offering.
   */
  freeImpact(params) {
    const { paidPrice, freeUserCost, freeLeads, baseConversionRate, freeUpliftMultiplier } = params;
    const totalFreeCost      = freeLeads * freeUserCost;
    const baseConversions    = Math.round(freeLeads * baseConversionRate);
    const upliftConversions  = Math.round(freeLeads * baseConversionRate * freeUpliftMultiplier);
    const incrementalRevenue = (upliftConversions - baseConversions) * paidPrice * 12;
    const roi                = totalFreeCost > 0 ? (incrementalRevenue - totalFreeCost) / totalFreeCost : 0;
    const breakevenConvRate  = totalFreeCost / (freeLeads * paidPrice * 12);

    return {
      totalFreeCost,
      baseConversions,
      upliftConversions,
      incrementalRevenue,
      roi,
      breakevenConvRate,
      isViable: roi > 0
    };
  },

  /**
   * Score a pricing metric on 4 parameters.
   */
  metricScore(metric) {
    const { operational, demand, expectation, density } = metric;
    const score = (operational + demand + expectation + density) / 4;
    const label = score >= 4 ? 'Strong metric' : score >= 3 ? 'Adequate metric' : 'Weak metric — consider alternatives';
    return { score, label };
  }
};


window.Module_m6 = {

  _results: null,
  _vwResponses: {
    tooCheap:    [20,25,30,25,15,20,25,30,35,20],
    cheap:       [40,45,50,55,60,45,50,55,50,45],
    expensive:   [80,90,100,85,95,90,100,95,85,80],
    tooExpensive:[120,130,140,150,130,140,150,160,120,130]
  },

  init() {
    const pane = document.getElementById('pane-m6');
    pane.innerHTML = `
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-eyebrow">Strategic design · Module 6</div>
          <div class="module-title">SaaS pricing studio</div>
          <div class="module-desc">Pricing metric design, packaging architecture, Van Westendorp PSM, ARR impact modelling, grandfathering planner, decoy tier designer, FREE! modeller.</div>
        </div>
        <div class="module-header-right">
          <span class="tag tag-phase-3">Phase 3</span>
          <span class="tag" style="background:var(--teal-lt);color:var(--teal)">No data required</span>
        </div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:2px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:1px;flex-wrap:wrap">
        ${['Metric design','Van Westendorp','ARR model','Grandfathering','FREE! model','Decoy designer','Tone advisor'].map((t,i) =>
          `<button onclick="Module_m6._tab(${i})" id="m6-tab-${i}"
            style="font-size:11px;padding:7px 12px;border:none;border-bottom:${i===0?'2px solid var(--accent)':'2px solid transparent'};
            background:transparent;color:${i===0?'var(--accent)':'var(--tx-3)'};cursor:pointer;font-family:inherit;white-space:nowrap">${t}</button>`
        ).join('')}
      </div>

      <!-- Tab 0: Metric design -->
      <div id="m6-t0">
        <div class="framework-callout" style="margin-bottom:16px">
          <div class="fc-icon">◎</div>
          <div class="fc-body">
            <div class="fc-label">Pricing metric design</div>
            <div class="fc-text">The right pricing metric aligns what you charge with the value customers receive. Score your candidate metric on 4 dimensions: operational viability, demand correlation, customer expectation to pay, and metric density (how naturally value accumulates with usage).</div>
          </div>
        </div>
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Score your pricing metric</div></div>
          <div style="margin-bottom:10px">
            <input class="config-input" id="m6-metric-name" placeholder="Metric name (e.g. per seat, per API call, per GB)" style="max-width:300px">
          </div>
          ${[
            ['operational', 'Operational viability', 'Can you measure, bill, and explain this metric to a customer?', '1=very hard · 5=trivial'],
            ['demand',      'Demand correlation',    'Does usage of this metric grow as the customer gets more value?', '1=no correlation · 5=perfect proxy'],
            ['expectation', 'Expectation to pay',   'Do customers already expect to pay for this unit of consumption?', '1=no expectation · 5=industry norm'],
            ['density',     'Metric density',        'Does value accumulate naturally as the metric grows?', '1=flat · 5=strong curve']
          ].map(([id,label,desc,hint]) => `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-2)">
              <div style="flex:1">
                <div style="font-size:12px;color:var(--tx-1);margin-bottom:2px">${label}</div>
                <div style="font-size:10px;color:var(--tx-3)">${desc}</div>
              </div>
              <div style="font-size:10px;color:var(--tx-3);width:120px">${hint}</div>
              <input type="range" min="1" max="5" step="1" value="3" id="m6-met-${id}"
                style="width:100px;accent-color:var(--accent)"
                oninput="document.getElementById('m6-met-${id}-v').textContent=this.value">
              <div id="m6-met-${id}-v" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent);width:14px">3</div>
            </div>`).join('')}
          <div class="config-run-row">
            <button class="btn-run" onclick="Module_m6._runMetric()">Score metric</button>
          </div>
        </div>
        <div id="m6-metric-output" style="display:none;margin-top:16px">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 20px">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
              <div class="stat-value" id="m6-met-score" style="font-size:36px;color:var(--accent)">—</div>
              <div id="m6-met-label" style="font-size:14px;font-weight:500;color:var(--tx-1)">—</div>
            </div>
            <div id="m6-met-bars"></div>
          </div>
        </div>
      </div>

      <!-- Tab 1: Van Westendorp -->
      <div id="m6-t1" style="display:none">
        <div class="framework-callout" style="margin-bottom:16px">
          <div class="fc-icon">◎</div>
          <div class="fc-body">
            <div class="fc-label">Van Westendorp PSM</div>
            <div class="fc-text">Four questions, asked to buyers or your internal team: at what price is this too cheap to trust? A bargain? Getting expensive? Too expensive? The intersections of the four response curves define the acceptable price range and the optimal price point.</div>
          </div>
        </div>
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Price responses (comma-separated values, one per respondent)</div></div>
          ${[
            ['tooCheap',    '1. Too cheap to trust', 'At what price would this be so cheap you\'d question the quality?'],
            ['cheap',       '2. Bargain',             'At what price is this starting to feel like a bargain?'],
            ['expensive',   '3. Getting expensive',   'At what price is this starting to feel expensive?'],
            ['tooExpensive','4. Too expensive',       'At what price is this too expensive to consider?']
          ].map(([id,label,q]) => `
            <div style="margin-bottom:10px">
              <label class="config-label" style="margin-bottom:4px">${label}<br><span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--tx-3)">${q}</span></label>
              <input class="config-input" id="m6-vw-${id}" value="${this._vwResponses[id].join(',')}" style="font-family:var(--font-mono);font-size:11px">
            </div>`).join('')}
          <div class="config-run-row">
            <button class="btn-run" onclick="Module_m6._runVW()">Generate PSM curves</button>
            <span class="run-hint">Pre-filled with sample responses — replace with real data</span>
          </div>
        </div>
        <div id="m6-vw-output" style="display:none;margin-top:16px">
          <div class="output-grid single">
            <div class="output-card">
              <div class="output-card-header">
                <div class="output-card-title">PSM curves — price sensitivity meter</div>
                <button class="output-card-export" onclick="Module_m6.export('vw-png')">↓ PNG</button>
              </div>
              <div class="output-card-body" style="padding:12px 16px 16px">
                <canvas id="m6-vw-chart" height="280"></canvas>
              </div>
            </div>
          </div>
          <div class="stat-row" id="m6-vw-stats" style="display:none">
            <div class="stat-card"><div class="stat-label">Optimal price (OPP)</div><div class="stat-value" id="m6-vw-opp" style="color:var(--accent)">—</div><div class="stat-sub">too cheap = too expensive</div></div>
            <div class="stat-card"><div class="stat-label">Price floor (PMC)</div><div class="stat-value" id="m6-vw-pmc" style="color:var(--teal)">—</div><div class="stat-sub">marginal cheapness point</div></div>
            <div class="stat-card"><div class="stat-label">Price ceiling (PME)</div><div class="stat-value" id="m6-vw-pme" style="color:var(--red)">—</div><div class="stat-sub">marginal expensiveness point</div></div>
            <div class="stat-card"><div class="stat-label">Acceptable range</div><div class="stat-value" id="m6-vw-range" style="color:var(--tx-1);font-size:18px">—</div><div class="stat-sub">PMC to PME</div></div>
          </div>
        </div>
      </div>

      <!-- Tab 2: ARR model -->
      <div id="m6-t2" style="display:none">
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">ARR impact model</div></div>
          <div class="config-row">
            <div class="config-field"><label class="config-label">Current ARR ($)</label><input class="config-input" type="number" id="m6-arr-current" value="500000" min="0" step="1000"></div>
            <div class="config-field"><label class="config-label">Current price ($/month)</label><input class="config-input" type="number" id="m6-arr-curr-price" value="199" min="0" step="1"></div>
            <div class="config-field"><label class="config-label">New price ($/month)</label><input class="config-input" type="number" id="m6-arr-new-price" value="249" min="0" step="1"></div>
          </div>
          <div class="config-row">
            <div class="config-field"><label class="config-label">Existing customers</label><input class="config-input" type="number" id="m6-arr-existing" value="210" min="0" step="1"></div>
            <div class="config-field"><label class="config-label">Churn rate from increase (%)</label><input class="config-input" type="number" id="m6-arr-churn" value="8" min="0" max="100" step="0.5"><div class="config-hint">Estimated % of existing customers who will churn due to the price change</div></div>
            <div class="config-field"><label class="config-label">Monthly new leads</label><input class="config-input" type="number" id="m6-arr-leads" value="500" min="0" step="10"></div>
            <div class="config-field"><label class="config-label">Current conversion rate (%)</label><input class="config-input" type="number" id="m6-arr-conv" value="4" min="0" max="100" step="0.1"></div>
          </div>
          <div class="config-run-row">
            <button class="btn-run" onclick="Module_m6._runARR()">Model ARR impact</button>
          </div>
        </div>
        <div id="m6-arr-output" style="display:none;margin-top:16px">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px;margin-bottom:16px">
            <div style="display:flex;gap:20px;flex-wrap:wrap">
              <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Current ARR</div><div style="font-size:20px;font-family:'Syne',sans-serif;font-weight:600;color:var(--tx-2)" id="m6-arr-base">—</div></div>
              <div style="font-size:20px;color:var(--tx-3);align-self:flex-end;padding-bottom:4px">→</div>
              <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Projected ARR</div><div style="font-size:20px;font-family:'Syne',sans-serif;font-weight:600" id="m6-arr-proj">—</div></div>
              <div style="width:1px;height:40px;background:var(--border);align-self:center"></div>
              <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">ARR change</div><div style="font-size:28px;font-family:'Syne',sans-serif;font-weight:600" id="m6-arr-delta">—</div></div>
            </div>
          </div>
          <div class="stat-row">
            <div class="stat-card"><div class="stat-label">Churned customers</div><div class="stat-value" id="m6-arr-churned" style="color:var(--red)">—</div></div>
            <div class="stat-card"><div class="stat-label">Retained customers</div><div class="stat-value" id="m6-arr-retained" style="color:var(--teal)">—</div></div>
            <div class="stat-card"><div class="stat-label">New conversions/mo</div><div class="stat-value" id="m6-arr-newconv" style="color:var(--accent)">—</div></div>
          </div>
        </div>
      </div>

      <!-- Tab 3: Grandfathering -->
      <div id="m6-t3" style="display:none">
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Grandfathering planner</div></div>
          <div class="config-row">
            <div class="config-field"><label class="config-label">Current price ($/month)</label><input class="config-input" type="number" id="m6-gf-curr" value="199" min="0"></div>
            <div class="config-field"><label class="config-label">New price ($/month)</label><input class="config-input" type="number" id="m6-gf-new" value="249" min="0"></div>
            <div class="config-field"><label class="config-label">Existing customers</label><input class="config-input" type="number" id="m6-gf-cust" value="210" min="0"></div>
            <div class="config-field"><label class="config-label">Monthly churn rate (%)</label><input class="config-input" type="number" id="m6-gf-churn" value="2" min="0" max="100" step="0.1"></div>
            <div class="config-field"><label class="config-label">Notice period (months)</label><input class="config-input" type="number" id="m6-gf-notice" value="3" min="1" max="24"></div>
          </div>
          <div class="config-run-row"><button class="btn-run" onclick="Module_m6._runGF()">Model rollout</button></div>
        </div>
        <div id="m6-gf-output" style="display:none;margin-top:16px">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 20px;margin-bottom:14px">
            <div style="display:flex;gap:20px;flex-wrap:wrap">
              <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Current run rate</div><div style="font-size:20px;font-family:'Syne',sans-serif;font-weight:600;color:var(--tx-2)" id="m6-gf-curr-rr">—</div></div>
              <div style="font-size:20px;color:var(--tx-3);align-self:center">→</div>
              <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Post-transition ARR</div><div style="font-size:20px;font-family:'Syne',sans-serif;font-weight:600" id="m6-gf-new-rr">—</div></div>
              <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Net ARR change</div><div style="font-size:20px;font-family:'Syne',sans-serif;font-weight:600" id="m6-gf-net">—</div></div>
            </div>
          </div>
          <div class="output-card">
            <div class="output-card-header"><div class="output-card-title">MRR through transition</div></div>
            <div class="output-card-body" style="padding:12px 16px"><canvas id="m6-gf-chart" height="200"></canvas></div>
          </div>
        </div>
      </div>

      <!-- Tab 4: FREE! model -->
      <div id="m6-t4" style="display:none">
        <div class="framework-callout" style="margin-bottom:16px">
          <div class="fc-icon">◎</div>
          <div class="fc-body">
            <div class="fc-label">FREE! impact model — Ariely Ch.3</div>
            <div class="fc-text">Zero is not just a low price — it removes perceived risk entirely. This model quantifies whether the conversion uplift from a free offering justifies its cost, and calculates the minimum conversion rate needed to break even.</div>
          </div>
        </div>
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">FREE! viability model</div></div>
          <div class="config-row">
            <div class="config-field"><label class="config-label">Paid plan price ($/month)</label><input class="config-input" type="number" id="m6-free-price" value="99" min="0"></div>
            <div class="config-field"><label class="config-label">Cost to serve free user ($/month)</label><input class="config-input" type="number" id="m6-free-cost" value="2" min="0" step="0.1"></div>
            <div class="config-field"><label class="config-label">Monthly free signups</label><input class="config-input" type="number" id="m6-free-leads" value="1000" min="0"></div>
            <div class="config-field"><label class="config-label">Base conversion rate (%)</label><input class="config-input" type="number" id="m6-free-conv" value="3" min="0" max="100" step="0.1"><div class="config-hint">Without free offering</div></div>
            <div class="config-field"><label class="config-label">FREE! conversion multiplier</label><input class="config-input" type="number" id="m6-free-mult" value="1.8" min="1" step="0.1"><div class="config-hint">Expected uplift from free entry (1.5–3× is typical)</div></div>
          </div>
          <div class="config-run-row"><button class="btn-run" onclick="Module_m6._runFree()">Model FREE! impact</button></div>
        </div>
        <div id="m6-free-output" style="display:none;margin-top:16px">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 20px">
            <div class="stat-row" style="margin-bottom:0">
              <div class="stat-card"><div class="stat-label">Monthly free cost</div><div class="stat-value" id="m6-free-cost-out" style="color:var(--red)">—</div></div>
              <div class="stat-card"><div class="stat-label">Incremental conversions</div><div class="stat-value" id="m6-free-inc-conv" style="color:var(--teal)">—</div></div>
              <div class="stat-card"><div class="stat-label">Incremental ARR</div><div class="stat-value" id="m6-free-inc-arr" style="color:var(--accent)">—</div></div>
              <div class="stat-card"><div class="stat-label">ROI</div><div class="stat-value" id="m6-free-roi">—</div></div>
            </div>
            <div style="margin-top:14px;padding:10px 14px;background:var(--bg-card-2);border-radius:var(--r-md);font-size:12px;line-height:1.6" id="m6-free-interp"></div>
          </div>
        </div>
      </div>

      <!-- Tab 5: Decoy designer -->
      <div id="m6-t5" style="display:none">
        <div class="framework-callout" style="margin-bottom:16px">
          <div class="fc-icon">◎</div>
          <div class="fc-body">
            <div class="fc-label">Decoy tier designer — Ariely Ch.1</div>
            <div class="fc-text">A decoy is a tier that makes your primary tier look like the obvious choice. The Economist: print-only at $125 caused 84% to choose print+web at $125 rather than web-only at $59. The decoy doesn't need to sell — it needs to reframe the primary.</div>
          </div>
        </div>
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Analyse your tier structure for decoy positioning</div></div>
          <div id="m6-decoy-tiers">
            ${this._renderDecoyTiers([
              { name: 'Starter', price: 49,  features: 'Core features, 1 user' },
              { name: 'Growth',  price: 149, features: 'Core + advanced, 5 users' },
              { name: 'Pro',     price: 199, features: 'Core + advanced, unlimited users' }
            ])}
          </div>
          <button class="export-btn" onclick="Module_m6._addDecoyTier()" style="height:24px;font-size:10px;margin-top:6px">+ add tier</button>
          <div class="config-run-row"><button class="btn-run" onclick="Module_m6._runDecoy()">Analyse decoy structure</button></div>
        </div>
        <div id="m6-decoy-output" style="display:none;margin-top:16px"></div>
      </div>

      <!-- Tab 6: Tone advisor -->
      <div id="m6-t6" style="display:none">
        <div class="framework-callout" style="margin-bottom:16px">
          <div class="fc-icon">◎</div>
          <div class="fc-body">
            <div class="fc-label">Pricing tone advisor — Ariely Ch.4</div>
            <div class="fc-text">Introducing money into a social context destroys goodwill that no amount of money can restore. How you describe your pricing — as a subscription, a membership, a usage meter, or a transaction — signals which norm applies and changes how buyers evaluate the relationship.</div>
          </div>
        </div>
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Assess your pricing communication</div></div>
          <div style="margin-bottom:12px">
            <label class="config-label" style="margin-bottom:6px">How do you describe your pricing?</label>
            <textarea class="config-input" id="m6-tone-text" rows="3" style="height:auto;padding:8px 10px;resize:vertical"
              placeholder="e.g. 'Pay per API call with volume discounts. Billing is monthly based on consumption. Overage charges apply above 10,000 calls.'"></textarea>
          </div>
          <div class="config-row">
            <div class="config-field">
              <label class="config-label">Customer relationship type</label>
              <select class="config-select" id="m6-tone-rel">
                <option value="enterprise">Enterprise (long-term, high-touch)</option>
                <option value="smb">SMB (medium-term, self-serve)</option>
                <option value="consumer">Consumer / PLG (short-term, transactional)</option>
              </select>
            </div>
            <div class="config-field">
              <label class="config-label">Pricing model type</label>
              <select class="config-select" id="m6-tone-model">
                <option value="flat">Flat subscription</option>
                <option value="seats">Per seat</option>
                <option value="usage">Usage-based / metered</option>
                <option value="hybrid">Hybrid (subscription + usage)</option>
              </select>
            </div>
          </div>
          <div class="config-run-row"><button class="btn-run" onclick="Module_m6._runTone()">Analyse pricing tone</button></div>
        </div>
        <div id="m6-tone-output" style="display:none;margin-top:16px"></div>
      </div>

      <!-- Export bar -->
      <div class="export-bar" style="margin-top:20px">
        <span class="export-label">Export</span>
        <button class="export-btn" onclick="Module_m6.export('vw-png')">VW chart PNG</button>
        <button class="export-btn" onclick="Module_m6.export('arr-csv')">ARR model CSV</button>
        <button class="export-btn add-to-session" onclick="Module_m6.export('session')">+ Add to session export</button>
      </div>
    `;

    this._gfChart = null;
    this._vwChart = null;
  },

  _tab(i) {
    for (let j = 0; j < 7; j++) {
      const p = document.getElementById('m6-t' + j);
      const b = document.getElementById('m6-tab-' + j);
      if (p) p.style.display = j === i ? '' : 'none';
      if (b) {
        b.style.borderBottom = j === i ? '2px solid var(--accent)' : '2px solid transparent';
        b.style.color        = j === i ? 'var(--accent)' : 'var(--tx-3)';
      }
    }
  },

  run() { this._tab(0); },

  // ── Metric design ─────────────────────────────────────────────────────────
  _runMetric() {
    const get = id => parseInt(document.getElementById('m6-met-' + id)?.value || 3);
    const metric = { operational: get('operational'), demand: get('demand'), expectation: get('expectation'), density: get('density') };
    const result = SaaSEngine.metricScore(metric);
    document.getElementById('m6-metric-output').style.display = '';
    const scoreEl = document.getElementById('m6-met-score');
    scoreEl.textContent = result.score.toFixed(1);
    scoreEl.style.color = result.score >= 4 ? 'var(--teal)' : result.score >= 3 ? 'var(--amber)' : 'var(--red)';
    document.getElementById('m6-met-label').textContent = result.label;
    const labels = { operational:'Operational viability', demand:'Demand correlation', expectation:'Expectation to pay', density:'Metric density' };
    document.getElementById('m6-met-bars').innerHTML = Object.entries(metric).map(([k,v]) => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="flex:0 0 160px;font-size:11px;color:var(--tx-3)">${labels[k]}</div>
        <div style="flex:1;background:var(--bg-app);border-radius:3px;height:8px"><div style="width:${v/5*100}%;height:100%;background:${v>=4?'rgba(46,196,160,0.6)':v>=3?'rgba(200,169,110,0.6)':'rgba(224,92,92,0.6)'};border-radius:3px"></div></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--accent);width:14px">${v}</div>
      </div>`).join('');
  },

  // ── Van Westendorp ────────────────────────────────────────────────────────
  _runVW() {
    const parse = id => document.getElementById('m6-vw-' + id)?.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v) && v > 0) || [];
    const responses = {
      tooCheap:     parse('tooCheap'),
      cheap:        parse('cheap'),
      expensive:    parse('expensive'),
      tooExpensive: parse('tooExpensive')
    };
    if (Object.values(responses).some(r => r.length < 3)) {
      Toast.warning('Enter at least 3 values per question');
      return;
    }
    const result = SaaSEngine.vanWestendorp(responses);
    if (result.error) { Toast.error(result.error); return; }
    this._vwResult = result;
    AppState.setResult('m6_vw', result);

    document.getElementById('m6-vw-output').style.display = '';
    document.getElementById('m6-vw-stats').style.display  = '';
    document.getElementById('m6-vw-opp').textContent   = result.opp   ? UI.fmtCurrency(result.opp)   : '—';
    document.getElementById('m6-vw-pmc').textContent   = result.pmc   ? UI.fmtCurrency(result.pmc)   : '—';
    document.getElementById('m6-vw-pme').textContent   = result.pme   ? UI.fmtCurrency(result.pme)   : '—';
    document.getElementById('m6-vw-range').textContent = result.pmc && result.pme
      ? UI.fmtCurrency(result.pmc) + ' – ' + UI.fmtCurrency(result.pme) : '—';

    this._renderVWChart(result);
    Toast.success('PSM curves generated');
  },

  _renderVWChart(result) {
    if (this._vwChart) { this._vwChart.destroy(); this._vwChart = null; }
    const pts = result.points.filter((_,i) => i % 3 === 0); // sample for performance
    const labels = pts.map(p => '$' + p.price.toFixed(0));
    const ctx = document.getElementById('m6-vw-chart').getContext('2d');
    this._vwChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Too cheap',     data: pts.map(p => p.pctTooCheap*100),     borderColor:'rgba(91,156,246,0.8)', borderWidth:2, pointRadius:0, fill:false, tension:0.4 },
          { label: 'Bargain',       data: pts.map(p => p.pctCheap*100),         borderColor:'rgba(46,196,160,0.8)', borderWidth:2, pointRadius:0, fill:false, tension:0.4 },
          { label: 'Expensive',     data: pts.map(p => p.pctExpensive*100),     borderColor:'rgba(224,154,60,0.8)', borderWidth:2, pointRadius:0, fill:false, tension:0.4 },
          { label: 'Too expensive', data: pts.map(p => p.pctTooExpensive*100),  borderColor:'rgba(224,92,92,0.8)',  borderWidth:2, pointRadius:0, fill:false, tension:0.4 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: {
          legend: { display:true, position:'top', labels:{ color:'#A8A7A2', font:{size:10}, boxWidth:10, padding:12 } },
          tooltip: { backgroundColor:'#1E1E22', borderColor:'rgba(255,255,255,0.1)', borderWidth:1, titleColor:'#F0EFEC', bodyColor:'#A8A7A2', padding:10, cornerRadius:6,
            callbacks: { label: item => item.dataset.label + ': ' + item.raw.toFixed(1) + '%' } }
        },
        scales: {
          x: { grid:{display:false}, ticks:{color:'#65635E', font:{size:9}, maxTicksLimit:12} },
          y: { grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#65635E', font:{size:10}, callback:v=>v+'%'}, min:0, max:100 }
        }
      }
    });
  },

  // ── ARR model ─────────────────────────────────────────────────────────────
  _runARR() {
    const r = SaaSEngine.arrImpact({
      currentARR:      parseFloat(document.getElementById('m6-arr-current')?.value) || 0,
      currentPrice:    parseFloat(document.getElementById('m6-arr-curr-price')?.value) || 0,
      newPrice:        parseFloat(document.getElementById('m6-arr-new-price')?.value) || 0,
      existingCustomers:parseInt(document.getElementById('m6-arr-existing')?.value) || 0,
      churnRate:       parseFloat(document.getElementById('m6-arr-churn')?.value) / 100 || 0,
      conversionRate:  parseFloat(document.getElementById('m6-arr-conv')?.value) / 100 || 0,
      newCustomers:    parseInt(document.getElementById('m6-arr-leads')?.value) || 0
    });
    document.getElementById('m6-arr-output').style.display = '';
    document.getElementById('m6-arr-base').textContent     = UI.fmtCurrency(r.projectedARR - r.arrDelta, 0);
    const projEl = document.getElementById('m6-arr-proj');
    projEl.textContent = UI.fmtCurrency(r.projectedARR, 0);
    projEl.style.color = r.arrDelta >= 0 ? 'var(--teal)' : 'var(--red)';
    const deltaEl = document.getElementById('m6-arr-delta');
    deltaEl.textContent = (r.arrDelta >= 0 ? '+' : '') + UI.fmtCurrency(r.arrDelta, 0) + ' (' + (r.arrDeltaPct*100).toFixed(1) + '%)';
    deltaEl.style.color = r.arrDelta >= 0 ? 'var(--teal)' : 'var(--red)';
    document.getElementById('m6-arr-churned').textContent  = UI.fmtNum(r.churnedCustomers);
    document.getElementById('m6-arr-retained').textContent = UI.fmtNum(r.retainedCustomers);
    document.getElementById('m6-arr-newconv').textContent  = UI.fmtNum(r.convertedNew);
    AppState.setResult('m6_arr', r);
    Toast.success('ARR impact modelled');
  },

  // ── Grandfathering ────────────────────────────────────────────────────────
  _runGF() {
    const r = SaaSEngine.grandfathering({
      currentPrice:   parseFloat(document.getElementById('m6-gf-curr')?.value) || 0,
      newPrice:       parseFloat(document.getElementById('m6-gf-new')?.value) || 0,
      existingCustomers: parseInt(document.getElementById('m6-gf-cust')?.value) || 0,
      monthlyChurn:   parseFloat(document.getElementById('m6-gf-churn')?.value) / 100 || 0,
      noticeMonths:   parseInt(document.getElementById('m6-gf-notice')?.value) || 3
    });
    document.getElementById('m6-gf-output').style.display = '';
    document.getElementById('m6-gf-curr-rr').textContent = UI.fmtCurrency(r.currentRunRate, 0);
    const newRREl = document.getElementById('m6-gf-new-rr');
    newRREl.textContent = UI.fmtCurrency(r.finalRunRate, 0);
    newRREl.style.color = r.netArrChange >= 0 ? 'var(--teal)' : 'var(--red)';
    const netEl = document.getElementById('m6-gf-net');
    netEl.textContent = (r.netArrChange >= 0 ? '+' : '') + UI.fmtCurrency(r.netArrChange, 0);
    netEl.style.color = r.netArrChange >= 0 ? 'var(--teal)' : 'var(--red)';
    this._renderGFChart(r);
    Toast.success('Grandfathering rollout modelled');
  },

  _renderGFChart(r) {
    if (this._gfChart) { this._gfChart.destroy(); this._gfChart = null; }
    const ctx = document.getElementById('m6-gf-chart').getContext('2d');
    this._gfChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: r.stages.map(s => 'M' + s.month),
        datasets: [{
          label: 'MRR',
          data:  r.stages.map(s => s.mrr),
          borderColor: 'rgba(200,169,110,0.9)',
          backgroundColor: 'rgba(200,169,110,0.08)',
          borderWidth: 2, pointRadius: 2, fill: true, tension: 0.3
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { legend:{display:false}, tooltip:{ backgroundColor:'#1E1E22', borderColor:'rgba(255,255,255,0.1)', borderWidth:1, titleColor:'#F0EFEC', bodyColor:'#A8A7A2', padding:10, cornerRadius:6, callbacks:{ label: item => 'MRR: ' + UI.fmtCurrency(item.raw, 0) } } },
        scales: {
          x: { grid:{display:false}, ticks:{color:'#65635E',font:{size:9}} },
          y: { grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#65635E',font:{size:10},callback:v=>'$'+v.toFixed(0)} }
        }
      }
    });
  },

  // ── FREE! model ───────────────────────────────────────────────────────────
  _runFree() {
    const r = SaaSEngine.freeImpact({
      paidPrice:           parseFloat(document.getElementById('m6-free-price')?.value) || 99,
      freeUserCost:        parseFloat(document.getElementById('m6-free-cost')?.value) || 2,
      freeLeads:           parseInt(document.getElementById('m6-free-leads')?.value) || 1000,
      baseConversionRate:  parseFloat(document.getElementById('m6-free-conv')?.value) / 100 || 0.03,
      freeUpliftMultiplier:parseFloat(document.getElementById('m6-free-mult')?.value) || 1.8
    });
    document.getElementById('m6-free-output').style.display = '';
    document.getElementById('m6-free-cost-out').textContent  = UI.fmtCurrency(r.totalFreeCost, 0);
    document.getElementById('m6-free-inc-conv').textContent  = '+' + UI.fmtNum(r.upliftConversions - r.baseConversions);
    document.getElementById('m6-free-inc-arr').textContent   = UI.fmtCurrency(r.incrementalRevenue, 0);
    const roiEl = document.getElementById('m6-free-roi');
    roiEl.textContent = (r.roi * 100).toFixed(0) + '%';
    roiEl.style.color = r.roi > 0 ? 'var(--teal)' : 'var(--red)';
    const interpEl = document.getElementById('m6-free-interp');
    interpEl.innerHTML = r.isViable
      ? `<span style="color:var(--teal)">✓ Viable.</span> The FREE! offer generates a positive ROI at ${(r.roi*100).toFixed(0)}%. Breakeven conversion rate is ${(r.breakevenConvRate*100).toFixed(2)}% — your current estimate (${((parseFloat(document.getElementById('m6-free-conv')?.value)||3) * (parseFloat(document.getElementById('m6-free-mult')?.value)||1.8)).toFixed(1)}%) exceeds this threshold.`
      : `<span style="color:var(--red)">⚠ Not viable at current assumptions.</span> You need a conversion rate of at least ${(r.breakevenConvRate*100).toFixed(2)}% to break even on the cost of the free user base. Reduce cost-to-serve, increase paid price, or improve conversion before launching a free tier.`;
    AppState.setResult('m6_free', r);
    Toast.success('FREE! impact modelled');
  },

  // ── Decoy designer ────────────────────────────────────────────────────────
  _decoyTiers: [
    { name: 'Starter', price: 49,  features: 'Core features, 1 user' },
    { name: 'Growth',  price: 149, features: 'Core + advanced, 5 users' },
    { name: 'Pro',     price: 199, features: 'Core + advanced, unlimited users' }
  ],

  _renderDecoyTiers(tiers) {
    return tiers.map((t, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input class="config-input" style="width:100px;height:28px;font-size:11px" placeholder="Tier name" value="${t.name}" oninput="Module_m6._decoyTiers[${i}].name=this.value">
        <input class="config-input" type="number" style="width:80px;height:28px;font-size:11px;font-family:var(--font-mono)" placeholder="Price" value="${t.price}" oninput="Module_m6._decoyTiers[${i}].price=parseFloat(this.value)||0">
        <input class="config-input" style="flex:1;height:28px;font-size:11px" placeholder="Key features" value="${t.features}" oninput="Module_m6._decoyTiers[${i}].features=this.value">
        <button onclick="Module_m6._removeDecoyTier(${i})" style="width:22px;height:22px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);font-size:11px;cursor:pointer;flex-shrink:0">✕</button>
      </div>`).join('');
  },

  _addDecoyTier() {
    this._decoyTiers.push({ name: 'New tier', price: 0, features: '' });
    document.getElementById('m6-decoy-tiers').innerHTML = this._renderDecoyTiers(this._decoyTiers);
  },

  _removeDecoyTier(i) {
    this._decoyTiers.splice(i, 1);
    document.getElementById('m6-decoy-tiers').innerHTML = this._renderDecoyTiers(this._decoyTiers);
  },

  _runDecoy() {
    const tiers  = this._decoyTiers;
    const output = document.getElementById('m6-decoy-output');
    output.style.display = '';

    if (tiers.length < 2) { output.innerHTML = '<div style="color:var(--tx-3);font-size:12px">Add at least 2 tiers.</div>'; return; }

    const prices  = tiers.map(t => t.price).sort((a,b) => a-b);
    const maxP    = prices[prices.length-1];
    const midP    = prices.length >= 3 ? prices[Math.floor(prices.length/2)] : null;

    // Check if a "dominated" tier exists (similar price to higher tier, fewer features)
    const hasDecoy = tiers.length >= 3;
    const topGap   = tiers.length >= 3 ? (maxP - prices[prices.length-2]) / maxP : 0;
    const isGoodDecoy = topGap < 0.3; // Good decoy: top tier not too far from second-tier

    output.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 20px;margin-bottom:14px">
        <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Decoy analysis</div>
        ${tiers.map((t,i) => {
          const isTarget = midP && t.price === midP;
          const isDecoy  = tiers.length >= 3 && i === tiers.length-1 && topGap < 0.3;
          return `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-2)">
              <div style="flex:0 0 80px;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:${isTarget?'var(--accent)':'var(--tx-2)'}">${UI.fmtCurrency(t.price)}</div>
              <div style="flex:1;font-size:12px;color:var(--tx-2)">${t.name} — ${t.features}</div>
              ${isDecoy ? '<div style="font-size:10px;padding:2px 8px;border-radius:3px;background:var(--amber-lt);color:var(--amber)">Potential decoy</div>' : ''}
              ${isTarget ? '<div style="font-size:10px;padding:2px 8px;border-radius:3px;background:var(--accent-lt);color:var(--accent)">Target tier</div>' : ''}
            </div>`;
        }).join('')}
        <div style="margin-top:12px;padding:10px 14px;background:var(--bg-card-2);border-radius:var(--r-md);font-size:12px;color:var(--tx-2);line-height:1.6">
          ${hasDecoy && isGoodDecoy
            ? `✓ A potential decoy structure is present. The top tier is ${(topGap*100).toFixed(0)}% above the second tier — close enough to make the middle tier look like the rational choice. Verify that the top tier has only marginally more value than the middle — the decoy effect weakens if the top tier is genuinely much better.`
            : hasDecoy && !isGoodDecoy
            ? `⚠ Three tiers present but decoy positioning is weak. The top tier is ${(topGap*100).toFixed(0)}% above the second tier — too large a gap reduces the anchoring effect. Consider reducing the top tier price or increasing the middle tier features to make the comparison more direct.`
            : `⚠ Fewer than 3 tiers — no decoy effect available. Add a third tier above your primary to create comparison pressure. It doesn't need to sell; it needs to make the primary look like the obvious choice.`}
        </div>
      </div>`;
    Toast.success('Decoy analysis complete');
  },

  // ── Tone advisor ──────────────────────────────────────────────────────────
  _runTone() {
    const text     = document.getElementById('m6-tone-text')?.value || '';
    const rel      = document.getElementById('m6-tone-rel')?.value || 'smb';
    const model    = document.getElementById('m6-tone-model')?.value || 'flat';
    const output   = document.getElementById('m6-tone-output');
    output.style.display = '';

    // Detect market norm language
    const marketNormWords = ['per call','per request','overage','usage','consumption','metered','transaction','per unit','per api','per event'];
    const socialNormWords = ['subscription','membership','partnership','commitment','unlimited','all-inclusive','dedicated'];
    const marketScore = marketNormWords.filter(w => text.toLowerCase().includes(w)).length;
    const socialScore = socialNormWords.filter(w => text.toLowerCase().includes(w)).length;

    const norm = marketScore > socialScore ? 'market' : socialScore > marketScore ? 'social' : 'neutral';

    // Risk assessment
    const mismatch = (rel === 'enterprise' && norm === 'market') || (rel === 'consumer' && norm === 'social' && model !== 'flat');
    const risk     = mismatch ? 'high' : norm === 'neutral' ? 'medium' : 'low';
    const riskCol  = risk === 'high' ? 'var(--red)' : risk === 'medium' ? 'var(--amber)' : 'var(--teal)';

    output.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 20px">
        <div style="display:flex;gap:20px;margin-bottom:14px;flex-wrap:wrap">
          <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Detected norm</div>
            <div style="font-size:18px;font-weight:600;font-family:'Syne',sans-serif;color:${norm==='market'?'var(--blue)':norm==='social'?'var(--teal)':'var(--tx-2)'}">${norm.charAt(0).toUpperCase()+norm.slice(1)} norms</div></div>
          <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Mismatch risk</div>
            <div style="font-size:18px;font-weight:600;font-family:'Syne',sans-serif;color:${riskCol}">${risk.charAt(0).toUpperCase()+risk.slice(1)}</div></div>
          <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Market signals</div>
            <div style="font-size:14px;font-family:'JetBrains Mono',monospace;color:var(--blue)">${marketScore} words</div></div>
          <div><div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Social signals</div>
            <div style="font-size:14px;font-family:'JetBrains Mono',monospace;color:var(--teal)">${socialScore} words</div></div>
        </div>
        <div style="padding:10px 14px;background:var(--bg-card-2);border-radius:var(--r-md);font-size:12px;color:var(--tx-2);line-height:1.6;border-left:3px solid ${riskCol}">
          ${mismatch && rel === 'enterprise'
            ? `⚠ Your pricing language activates market norms in what is primarily a relational context. Enterprise buyers evaluating a long-term partnership will experience transactional language (per-call fees, overage charges, metered consumption) as a signal that you view them as a transaction, not a partner. This doesn't mean usage-based pricing is wrong — but the language used to describe it matters. Reframe consumption as a "growth model" or "usage flexibility" within a partnership context.`
            : norm === 'neutral'
            ? `Your pricing language is neutral — neither strongly relational nor transactional. This is safe but leaves the norm context undefined. Buyers in your target segment will apply their own norm expectations, which may or may not match your intended positioning.`
            : `Your pricing language is well-matched to your stated relationship context. ${norm === 'social' ? 'Social norm language (subscription, partnership, unlimited) signals commitment and relationship.' : 'Market norm language is appropriate for a transactional context.'}`}
        </div>
      </div>`;
    Toast.success('Tone analysis complete');
  },

  // ── Export ────────────────────────────────────────────────────────────────
  export(format) {
    if (format === 'vw-png') {
      const canvas = document.getElementById('m6-vw-chart');
      if (!canvas || !this._vwChart) { Toast.warning('Run Van Westendorp first'); return; }
      const link = document.createElement('a');
      link.download = 'van-westendorp-psm.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      Toast.success('PSM chart exported');
    }
    if (format === 'arr-csv') {
      const r = AppState.results?.m6_arr;
      if (!r) { Toast.warning('Run ARR model first'); return; }
      const csv = ['metric,value',`current_arr,${UI.fmtCurrency(r.projectedARR - r.arrDelta, 0)}`,`projected_arr,${UI.fmtCurrency(r.projectedARR, 0)}`,`arr_delta,${UI.fmtCurrency(r.arrDelta, 0)}`,`arr_delta_pct,${(r.arrDeltaPct*100).toFixed(1)}%`,`churned_customers,${r.churnedCustomers}`,`retained_customers,${r.retainedCustomers}`,`new_conversions_monthly,${r.convertedNew}`].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'arr-impact.csv';
      link.href = URL.createObjectURL(blob);
      link.click();
      Toast.success('ARR model exported');
    }
    if (format === 'session') {
      AppState.setResult('m6', { vw: this._vwResult, arr: AppState.results?.m6_arr });
      Toast.success('Added to session export');
    }
  }
};
