/**
 * M5 — Economic Value & Price Positioning
 * ─────────────────────────────────────────────────────────────────────────────
 * EVE model builder, price floor/ceiling calculator, skim/penetrate/neutral
 * positioning selector, price sensitivity checklist, and anchor simulator.
 *
 * No dataset required — runs entirely on manual inputs.
 */

'use strict';

const EVEEngine = {

  /**
   * Economic Value Estimation.
   * totalEV = referencePrice + differentiationValue
   * where differentiationValue = sum of value drivers (cost savings + benefit premiums)
   */
  compute(referencePrice, drivers) {
    const differentiationValue = drivers.reduce((s, d) => s + (parseFloat(d.value) || 0), 0);
    const totalEV   = referencePrice + differentiationValue;
    const priceFloor= referencePrice * 0.85; // cost-based floor approximation
    const priceCeiling = totalEV;

    return {
      referencePrice,
      differentiationValue,
      totalEV,
      priceFloor,
      priceCeiling,
      viableRange: { low: referencePrice, high: totalEV },
      drivers
    };
  },

  /**
   * Price sensitivity composite score from Nagle's 9 factors.
   * Each factor scored 1–5 (1 = reduces sensitivity, 5 = increases sensitivity)
   */
  sensitivityScore(factors) {
    const weights = {
      substitution:    0.15,
      switching:       0.15,
      expenditure:     0.10,
      endBenefit:      0.10,
      sharedCost:      0.10,
      fairness:        0.10,
      priceQuality:    0.10,
      inventoryEffect: 0.10,
      uniqueness:      0.10
    };
    let weightedSum = 0;
    let totalWeight = 0;
    Object.entries(factors).forEach(([key, score]) => {
      if (weights[key]) {
        weightedSum += score * weights[key];
        totalWeight += weights[key];
      }
    });
    const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const label = composite < 2.5 ? 'Low sensitivity'
      : composite < 3.5 ? 'Moderate sensitivity'
      : 'High sensitivity';
    return { composite, label };
  },

  /**
   * Anchor simulator — Ariely arbitrary coherence.
   * Models WTP shift under different anchor conditions.
   */
  anchorShift(proposedPrice, anchorPrice, anchorType) {
    // Documented shifts from anchoring research:
    // High anchor (above WTP): +8–15% WTP increase
    // Low anchor (below WTP):  -6–12% WTP decrease
    // No anchor: baseline
    const shifts = {
      high_competitor: { label: 'High competitor MSRP shown', shift: 0.10 },
      low_competitor:  { label: 'Low competitor price shown', shift: -0.09 },
      no_anchor:       { label: 'No reference price shown',   shift: 0 },
      internal_budget: { label: 'Budget amount shown first',  shift: 0.07 },
      previous_price:  { label: 'Previous (higher) price shown', shift: 0.12 }
    };
    const s = shifts[anchorType] || shifts.no_anchor;
    const adjustedWTP = proposedPrice * (1 + s.shift);
    return {
      anchorLabel:    s.label,
      anchorPrice,
      proposedPrice,
      shift:          s.shift,
      adjustedWTP,
      interpretation: s.shift > 0
        ? `Showing ${s.label.toLowerCase()} increases buyer WTP by ~${(s.shift*100).toFixed(0)}% — a price of ${UI.fmtCurrency(proposedPrice)} feels more acceptable`
        : s.shift < 0
        ? `Showing ${s.label.toLowerCase()} decreases buyer WTP by ~${(Math.abs(s.shift)*100).toFixed(0)}% — negotiate or present price without this anchor`
        : 'No anchor effect — buyers evaluate the price without a reference point'
    };
  },

  /**
   * Strategic positioning assessment.
   * Returns feasibility flags for skim / penetrate / neutral.
   */
  positioningAssessment(inputs) {
    const {
      priceSensitivity, competitiveProtection, marketGrowth,
      customerSwitchingCost, productDifferentiation, unitCostReduction
    } = inputs;

    const skimScore = (
      (5 - priceSensitivity)   * 0.25 +
      competitiveProtection    * 0.25 +
      productDifferentiation   * 0.30 +
      customerSwitchingCost    * 0.20
    );
    const penetrateScore = (
      priceSensitivity         * 0.30 +
      (5 - competitiveProtection) * 0.20 +
      marketGrowth             * 0.25 +
      unitCostReduction        * 0.25
    );
    const neutralScore = 5 - Math.max(Math.abs(skimScore - 2.5), Math.abs(penetrateScore - 2.5));

    const recommended = skimScore >= penetrateScore && skimScore >= 3.5 ? 'skim'
      : penetrateScore >= skimScore && penetrateScore >= 3.5 ? 'penetrate'
      : 'neutral';

    return { skimScore, penetrateScore, neutralScore, recommended };
  }
};


window.Module_m5 = {

  _eveDrivers:   [
    { name: 'Cost saving vs alternative', value: 0 },
    { name: 'Performance improvement',    value: 0 },
    { name: 'Risk reduction',             value: 0 }
  ],
  _sensitivityFactors: {
    substitution: 3, switching: 3, expenditure: 3, endBenefit: 3,
    sharedCost: 3, fairness: 3, priceQuality: 3, inventoryEffect: 3, uniqueness: 3
  },
  _results: null,

  init() {
    const pane = document.getElementById('pane-m5');
    pane.innerHTML = `
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-eyebrow">Strategic design · Module 5</div>
          <div class="module-title">Economic value & positioning</div>
          <div class="module-desc">EVE model, price floor/ceiling, strategic positioning selector, price sensitivity scoring, and anchor simulator.</div>
        </div>
        <div class="module-header-right">
          <span class="tag tag-phase-2">Phase 2</span>
          <span class="tag" style="background:var(--teal-lt);color:var(--teal)">No data required</span>
        </div>
      </div>

      <div class="framework-callout" onclick="Module_m5._toggleFC()">
        <div class="fc-icon">◎</div>
        <div class="fc-body">
          <div class="fc-label">Framework — economic value estimation</div>
          <div class="fc-text" id="m5-fc-text">Total economic value = reference price + differentiation value. The reference price is what the buyer would pay for the best alternative. Differentiation value is the worth of everything that makes your product better or worse than that alternative. The viable price range runs from the reference price floor to the total economic value ceiling.</div>
        </div>
        <div class="fc-expand">▲</div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:1px">
        ${['EVE model','Sensitivity','Positioning','Anchor simulator'].map((t,i) =>
          `<button onclick="Module_m5._tab(${i})" id="m5-tab-${i}"
            style="font-size:12px;padding:7px 14px;border:none;border-bottom:${i===0?'2px solid var(--accent)':'2px solid transparent'};
            background:transparent;color:${i===0?'var(--accent)':'var(--tx-3)'};cursor:pointer;font-family:inherit;font-weight:${i===0?'500':'400'}">${t}</button>`
        ).join('')}
      </div>

      <!-- Tab 0: EVE model -->
      <div id="m5-t0">
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">EVE inputs</div></div>
          <div class="config-row">
            <div class="config-field">
              <label class="config-label">Reference price ($) — best alternative <span class="required">*</span></label>
              <input class="config-input" type="number" id="m5-ref-price" value="100" min="0" step="0.01">
              <div class="config-hint">Price of the next-best substitute the buyer would use</div>
            </div>
            <div class="config-field">
              <label class="config-label">Product / offer name</label>
              <input class="config-input" type="text" id="m5-product-name" value="Our product" placeholder="For labelling outputs">
            </div>
          </div>
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-2)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div class="config-panel-title">Value drivers — what makes your product better/worse</div>
              <button class="export-btn" onclick="Module_m5._addDriver()" style="height:24px;font-size:10px">+ add driver</button>
            </div>
            <div id="m5-drivers-list">${this._renderDrivers()}</div>
          </div>
          <div class="config-run-row">
            <button class="btn-run" onclick="Module_m5.run()">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polygon points="3,1 11,6 3,11" fill="currentColor"/></svg>
              Calculate EVE
            </button>
          </div>
        </div>

        <!-- EVE output -->
        <div id="m5-eve-output" style="display:none">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px;margin-bottom:20px">
            <div style="font-size:10px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.07em;color:var(--tx-3);margin-bottom:14px">Economic value waterfall</div>
            <div id="m5-eve-bars" style="display:flex;flex-direction:column;gap:8px"></div>
            <div style="margin-top:16px;display:flex;gap:20px;flex-wrap:wrap">
              <div><div style="font-size:10px;color:var(--tx-3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em">Reference price</div>
                <div class="stat-value" id="m5-ref-out" style="font-size:22px;color:var(--tx-2)">—</div></div>
              <div><div style="font-size:10px;color:var(--tx-3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em">Differentiation value</div>
                <div class="stat-value" id="m5-diff-out" style="font-size:22px;color:var(--teal)">—</div></div>
              <div><div style="font-size:10px;color:var(--tx-3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em">Total economic value</div>
                <div class="stat-value" id="m5-tev-out" style="font-size:22px;color:var(--accent)">—</div></div>
            </div>
            <div style="margin-top:14px;padding:10px 14px;background:var(--bg-card-2);border-radius:var(--r-md);font-size:12px;color:var(--tx-2);line-height:1.6">
              <strong style="color:var(--tx-1)">Viable price range:</strong>
              <span id="m5-range-text"></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 1: Sensitivity -->
      <div id="m5-t1" style="display:none">
        <div class="config-panel">
          <div class="config-panel-header">
            <div class="config-panel-title">Price sensitivity factors — rate each 1–5</div>
            <div style="font-size:10px;color:var(--tx-3)">1 = reduces sensitivity · 5 = increases sensitivity</div>
          </div>
          <div id="m5-sensitivity-list">${this._renderSensitivity()}</div>
          <div class="config-run-row">
            <button class="btn-run" onclick="Module_m5._runSensitivity()">Score sensitivity</button>
          </div>
        </div>
        <div id="m5-sensitivity-output" style="display:none;margin-top:16px">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
              <div class="stat-value" id="m5-sens-score" style="font-size:42px;color:var(--accent)">—</div>
              <div>
                <div id="m5-sens-label" style="font-size:15px;font-weight:500;color:var(--tx-1);margin-bottom:4px">—</div>
                <div id="m5-sens-desc" style="font-size:12px;color:var(--tx-3);max-width:480px;line-height:1.6"></div>
              </div>
            </div>
            <div id="m5-sens-bars" style="display:flex;flex-direction:column;gap:6px"></div>
          </div>
        </div>
      </div>

      <!-- Tab 2: Positioning -->
      <div id="m5-t2" style="display:none">
        <div class="config-panel">
          <div class="config-panel-header">
            <div class="config-panel-title">Strategic positioning inputs — rate each 1–5</div>
          </div>
          ${[
            ['priceSensitivity',      'Price sensitivity of target customers',      '1=low · 5=high'],
            ['competitiveProtection', 'Ability to protect price from competitors',   '1=easy to copy · 5=strong moat'],
            ['marketGrowth',          'Market growth rate',                          '1=declining · 5=fast-growing'],
            ['customerSwitchingCost', 'Customer switching cost',                     '1=easy to switch · 5=high lock-in'],
            ['productDifferentiation','Degree of product differentiation',           '1=commodity · 5=unique'],
            ['unitCostReduction',     'Ability to reduce cost per unit at scale',    '1=fixed costs · 5=strong learning curve']
          ].map(([id, label, hint]) => `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-2)">
              <div style="flex:1;font-size:12px;color:var(--tx-2)">${label}</div>
              <div style="font-size:10px;color:var(--tx-3);width:140px">${hint}</div>
              <input type="range" id="m5-pos-${id}" min="1" max="5" step="1" value="3"
                style="width:100px;accent-color:var(--accent)"
                oninput="document.getElementById('m5-pos-${id}-val').textContent=this.value">
              <div id="m5-pos-${id}-val" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent);width:16px;text-align:center">3</div>
            </div>`).join('')}
          <div class="config-run-row">
            <button class="btn-run" onclick="Module_m5._runPositioning()">Assess positioning</button>
          </div>
        </div>
        <div id="m5-positioning-output" style="display:none;margin-top:16px">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px">
            <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px">Positioning recommendation</div>
            <div id="m5-pos-result"></div>
          </div>
        </div>
      </div>

      <!-- Tab 3: Anchor simulator -->
      <div id="m5-t3" style="display:none">
        <div class="framework-callout" style="margin-bottom:16px">
          <div class="fc-icon">◎</div>
          <div class="fc-body">
            <div class="fc-label">Ariely — arbitrary coherence</div>
            <div class="fc-text">First prices become anchors. Buyers adjust from an anchor rather than evaluating the price independently. The anchor shown before your price is quoted can shift perceived willingness-to-pay by 7–15% in either direction.</div>
          </div>
        </div>
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Anchor scenario</div></div>
          <div class="config-row">
            <div class="config-field">
              <label class="config-label">Your proposed price ($) <span class="required">*</span></label>
              <input class="config-input" type="number" id="m5-anchor-price" value="120" min="0" step="0.01">
            </div>
            <div class="config-field">
              <label class="config-label">Anchor type</label>
              <select class="config-select" id="m5-anchor-type">
                <option value="no_anchor">No reference price shown</option>
                <option value="high_competitor">High competitor MSRP shown</option>
                <option value="low_competitor">Low competitor price shown</option>
                <option value="internal_budget">Customer budget figure shown first</option>
                <option value="previous_price" selected>Previous (higher) price shown</option>
              </select>
            </div>
            <div class="config-field">
              <label class="config-label">Anchor value ($)</label>
              <input class="config-input" type="number" id="m5-anchor-value" value="150" min="0" step="0.01">
              <div class="config-hint">The reference price shown to the buyer before yours</div>
            </div>
          </div>
          <div class="config-run-row">
            <button class="btn-run" onclick="Module_m5._runAnchor()">Simulate anchor effect</button>
          </div>
        </div>
        <div id="m5-anchor-output" style="display:none;margin-top:16px">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px">
            <div id="m5-anchor-result"></div>
          </div>
        </div>
      </div>

      <!-- Export bar -->
      <div class="export-bar" id="m5-export-bar" style="margin-top:20px">
        <span class="export-label">Export</span>
        <button class="export-btn" onclick="Module_m5.export('eve-csv')">EVE model CSV</button>
        <button class="export-btn add-to-session" onclick="Module_m5.export('session')">+ Add to session export</button>
      </div>
    `;
  },

  _tab(i) {
    [0,1,2,3].forEach(j => {
      const pane = document.getElementById('m5-t' + j);
      const btn  = document.getElementById('m5-tab-' + j);
      if (pane) pane.style.display = j === i ? '' : 'none';
      if (btn) {
        btn.style.borderBottom = j === i ? '2px solid var(--accent)' : '2px solid transparent';
        btn.style.color        = j === i ? 'var(--accent)' : 'var(--tx-3)';
        btn.style.fontWeight   = j === i ? '500' : '400';
      }
    });
  },

  run() {
    const refPrice = parseFloat(document.getElementById('m5-ref-price')?.value);
    if (isNaN(refPrice) || refPrice <= 0) { Toast.warning('Enter a valid reference price'); return; }

    const result = EVEEngine.compute(refPrice, this._eveDrivers);
    this._results = result;
    AppState.setResult('m5', result);

    // Render EVE bars
    document.getElementById('m5-eve-output').style.display = '';
    document.getElementById('m5-ref-out').textContent  = UI.fmtCurrency(result.referencePrice);
    document.getElementById('m5-diff-out').textContent = UI.fmtCurrency(result.differentiationValue);
    document.getElementById('m5-tev-out').textContent  = UI.fmtCurrency(result.totalEV);
    document.getElementById('m5-range-text').textContent =
      ` Set price between ${UI.fmtCurrency(result.referencePrice)} (reference floor) and ${UI.fmtCurrency(result.totalEV)} (total economic value ceiling). Prices above the ceiling leave value uncaptured; prices below the floor suggest the product may not be competitive on price alone.`;

    // Animated bars
    const barsEl = document.getElementById('m5-eve-bars');
    const maxVal = result.totalEV;
    barsEl.innerHTML = [
      { label: 'Reference price', value: result.referencePrice, colour: 'rgba(168,167,162,0.5)', textCol: 'var(--tx-2)' },
      ...result.drivers.map(d => ({ label: d.name, value: parseFloat(d.value) || 0, colour: parseFloat(d.value) >= 0 ? 'rgba(46,196,160,0.55)' : 'rgba(224,92,92,0.55)', textCol: parseFloat(d.value) >= 0 ? 'var(--teal)' : 'var(--red)' })),
      { label: 'Total economic value', value: result.totalEV, colour: 'rgba(200,169,110,0.65)', textCol: 'var(--accent)' }
    ].map(b => `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:0 0 180px;font-size:12px;color:var(--tx-2);text-align:right">${b.label}</div>
        <div style="flex:1;background:var(--bg-app);border-radius:3px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${Math.max(0, b.value)/maxVal*100}%;background:${b.colour};border-radius:3px;transition:width .5s"></div>
        </div>
        <div style="flex:0 0 70px;font-family:'JetBrains Mono',monospace;font-size:11px;color:${b.textCol};text-align:right">${UI.fmtCurrency(b.value)}</div>
      </div>`).join('');

    Toast.success('EVE calculated — total value ' + UI.fmtCurrency(result.totalEV));
  },

  _runSensitivity() {
    const result = EVEEngine.sensitivityScore(this._sensitivityFactors);
    document.getElementById('m5-sensitivity-output').style.display = '';

    const scoreEl = document.getElementById('m5-sens-score');
    scoreEl.textContent = result.composite.toFixed(1);
    scoreEl.style.color = result.composite < 2.5 ? 'var(--teal)' : result.composite < 3.5 ? 'var(--amber)' : 'var(--red)';
    document.getElementById('m5-sens-label').textContent = result.label;
    document.getElementById('m5-sens-desc').textContent  = result.composite < 2.5
      ? 'Buyers are relatively insensitive to price changes. Greater latitude for price increases; skim strategy may be viable.'
      : result.composite < 3.5
      ? 'Moderate sensitivity. Price changes will have measurable volume effects but are manageable with value communication.'
      : 'High price sensitivity. Price changes will materially affect volume. Value communication is critical before any increase.';

    // Factor bars
    const factorLabels = {
      substitution: 'Perceived substitutes', switching: 'Switching cost',
      expenditure: 'Expenditure effect', endBenefit: 'End-benefit effect',
      sharedCost: 'Shared cost', fairness: 'Price-quality fairness',
      priceQuality: 'Price–quality signal', inventoryEffect: 'Inventory effect', uniqueness: 'Uniqueness'
    };
    document.getElementById('m5-sens-bars').innerHTML = Object.entries(this._sensitivityFactors).map(([k, v]) => `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:0 0 160px;font-size:11px;color:var(--tx-3)">${factorLabels[k] || k}</div>
        <div style="flex:1;background:var(--bg-app);border-radius:3px;height:8px;overflow:hidden">
          <div style="width:${v/5*100}%;height:100%;background:${v<3?'rgba(46,196,160,0.6)':v<4?'rgba(224,154,60,0.6)':'rgba(224,92,92,0.6)'};border-radius:3px"></div>
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx-2);width:16px">${v}</div>
      </div>`).join('');
  },

  _runPositioning() {
    const get = id => parseInt(document.getElementById('m5-pos-' + id)?.value || 3);
    const inputs = {
      priceSensitivity:      get('priceSensitivity'),
      competitiveProtection: get('competitiveProtection'),
      marketGrowth:          get('marketGrowth'),
      customerSwitchingCost: get('customerSwitchingCost'),
      productDifferentiation:get('productDifferentiation'),
      unitCostReduction:     get('unitCostReduction')
    };
    const result = EVEEngine.positioningAssessment(inputs);
    document.getElementById('m5-positioning-output').style.display = '';

    const descriptions = {
      skim:       'Conditions support premium pricing. Strong differentiation and competitive protection allow you to maximise margin per unit before competitors or substitutes erode the position. Consider a sequential skimming schedule as the market matures.',
      penetrate:  'Conditions support aggressive entry pricing. High sensitivity, low switching costs, and strong unit cost reduction potential suggest volume is the route to margin. Price to build share, then manage the transition to higher prices as lock-in develops.',
      neutral:    'No strong signal for either skim or penetrate. Price at or near perceived economic value — neither leaving money on the table nor triggering unnecessary volume loss. Focus on value communication to reduce sensitivity.'
    };

    const colours = { skim: 'var(--accent)', penetrate: 'var(--teal)', neutral: 'var(--blue)' };

    document.getElementById('m5-pos-result').innerHTML = `
      <div style="display:flex;gap:14px;margin-bottom:16px;flex-wrap:wrap">
        ${['skim','penetrate','neutral'].map(s => `
          <div style="flex:1;min-width:120px;background:${s===result.recommended?'rgba(200,169,110,0.08)':'var(--bg-card-2)'};
            border:1px solid ${s===result.recommended?'var(--accent)':'var(--border)'};
            border-radius:var(--r-md);padding:12px 14px">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${s===result.recommended?colours[s]:'var(--tx-3)'};margin-bottom:4px">
              ${s.charAt(0).toUpperCase()+s.slice(1)} ${s===result.recommended?'← recommended':''}
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:18px;color:${s===result.recommended?colours[s]:'var(--tx-2)'}">
              ${(result[s+'Score']).toFixed(1)}<span style="font-size:11px;color:var(--tx-3)">/5</span>
            </div>
          </div>`).join('')}
      </div>
      <div style="font-size:13px;color:var(--tx-2);line-height:1.7;padding:12px 14px;background:var(--bg-card-2);border-radius:var(--r-md);border-left:3px solid ${colours[result.recommended]}">
        ${descriptions[result.recommended]}
      </div>`;
  },

  _runAnchor() {
    const price  = parseFloat(document.getElementById('m5-anchor-price')?.value);
    const anchor = parseFloat(document.getElementById('m5-anchor-value')?.value);
    const type   = document.getElementById('m5-anchor-type')?.value;
    if (isNaN(price) || price <= 0) { Toast.warning('Enter a valid price'); return; }

    const result = EVEEngine.anchorShift(price, anchor, type);
    document.getElementById('m5-anchor-output').style.display = '';

    const shiftDir  = result.shift > 0 ? '+' : '';
    const shiftCol  = result.shift > 0 ? 'var(--teal)' : result.shift < 0 ? 'var(--red)' : 'var(--tx-3)';

    document.getElementById('m5-anchor-result').innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-bottom:16px">
        <div>
          <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Your price</div>
          <div style="font-size:28px;font-family:'Syne',sans-serif;font-weight:600;color:var(--tx-1)">${UI.fmtCurrency(price)}</div>
        </div>
        <div style="padding-top:16px;font-size:18px;color:var(--tx-3)">→</div>
        <div>
          <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">WTP with anchor</div>
          <div style="font-size:28px;font-family:'Syne',sans-serif;font-weight:600;color:${shiftCol}">${UI.fmtCurrency(result.adjustedWTP)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">WTP shift</div>
          <div style="font-size:28px;font-family:'Syne',sans-serif;font-weight:600;color:${shiftCol}">${shiftDir}${(result.shift*100).toFixed(0)}%</div>
        </div>
      </div>
      <div style="font-size:13px;color:var(--tx-2);line-height:1.7;padding:10px 14px;background:var(--bg-card-2);border-radius:var(--r-md);border-left:3px solid ${shiftCol}">
        ${result.interpretation}
      </div>`;
  },

  _renderDrivers() {
    return this._eveDrivers.map((d, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input class="config-input" style="flex:1;height:28px;font-size:11px" placeholder="Driver name" value="${d.name}"
          oninput="Module_m5._eveDrivers[${i}].name = this.value">
        <input class="config-input" type="number" style="width:90px;height:28px;font-size:11px;font-family:var(--font-mono)" placeholder="Value $"
          value="${d.value}" step="0.01"
          oninput="Module_m5._eveDrivers[${i}].value = parseFloat(this.value) || 0">
        <div style="font-size:10px;color:var(--tx-3);width:80px">${parseFloat(d.value) >= 0 ? '↑ positive' : '↓ negative'}</div>
        <button onclick="Module_m5._removeDriver(${i})" style="width:22px;height:22px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);font-size:11px;cursor:pointer;flex-shrink:0">✕</button>
      </div>`).join('');
  },

  _renderSensitivity() {
    const labels = {
      substitution: ['Substitution effect', 'How easy is it for buyers to identify substitutes?'],
      switching:    ['Switching cost effect', 'How costly is it for buyers to switch to an alternative?'],
      expenditure:  ['Expenditure effect', 'What share of the buyer\'s budget does this represent?'],
      endBenefit:   ['End-benefit effect', 'How closely tied is the price to the buyer\'s own end product?'],
      sharedCost:   ['Shared cost effect', 'Do buyers pay the full cost themselves, or is it shared/reimbursed?'],
      fairness:     ['Price-fairness effect', 'How does this price compare to what buyers consider fair or historical?'],
      priceQuality: ['Price–quality effect', 'Do buyers use price as a signal of quality in this category?'],
      inventoryEffect: ['Inventory effect', 'Can buyers stock up to avoid a price increase?'],
      uniqueness:   ['Uniqueness effect', 'How unique is this product in the buyer\'s perception?']
    };
    return Object.entries(this._sensitivityFactors).map(([key, val]) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-2)">
        <div style="flex:1">
          <div style="font-size:12px;color:var(--tx-1);margin-bottom:2px">${labels[key][0]}</div>
          <div style="font-size:10px;color:var(--tx-3)">${labels[key][1]}</div>
        </div>
        <input type="range" min="1" max="5" step="1" value="${val}"
          style="width:100px;accent-color:var(--accent)"
          oninput="Module_m5._sensitivityFactors['${key}']=parseInt(this.value);document.getElementById('m5-sf-${key}').textContent=this.value">
        <div id="m5-sf-${key}" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent);width:14px;text-align:center">${val}</div>
      </div>`).join('');
  },

  _addDriver() {
    this._eveDrivers.push({ name: 'New driver', value: 0 });
    document.getElementById('m5-drivers-list').innerHTML = this._renderDrivers();
  },

  _removeDriver(i) {
    this._eveDrivers.splice(i, 1);
    document.getElementById('m5-drivers-list').innerHTML = this._renderDrivers();
  },

  export(format) {
    if (format === 'eve-csv' && this._results) {
      const r = this._results;
      const csv = [
        'component,value',
        'reference_price,' + r.referencePrice.toFixed(2),
        ...r.drivers.map(d => d.name + ',' + (parseFloat(d.value)||0).toFixed(2)),
        'differentiation_value,' + r.differentiationValue.toFixed(2),
        'total_economic_value,' + r.totalEV.toFixed(2)
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'eve-model.csv';
      link.href = URL.createObjectURL(blob);
      link.click();
      Toast.success('EVE model exported');
    }
    if (format === 'session' && this._results) {
      AppState.setResult('m5', this._results);
      Toast.success('Added to session export');
    }
  },

  _toggleFC() {
    const t = document.getElementById('m5-fc-text');
    if (t) t.style.display = t.style.display === 'none' ? '' : 'none';
  }
};
