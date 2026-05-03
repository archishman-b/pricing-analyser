/**
 * M4 — Margin Driver Decomposition
 * ─────────────────────────────────────────────────────────────────────────────
 * Contribution margin, breakeven analysis, 9-scenario what-if modelling,
 * and breakeven curve across a price change range.
 *
 * No Web Worker needed — all synchronous computation.
 * No dataset required — can run on manually entered inputs.
 */

'use strict';

// ── Margin engine ─────────────────────────────────────────────────────────────
const MarginEngine = {

  /**
   * Contribution margin calculation.
   */
  contributionMargin(price, variableCost) {
    const cm    = price - variableCost;
    const cmPct = price > 0 ? cm / price : 0;
    return { cm, cmPct };
  },

  /**
   * Breakeven sales change required after a price change.
   * Formula: −ΔP / (CM + ΔP)
   * Where ΔP = price change as absolute value (negative for a cut)
   */
  breakeven(price, variableCost, priceDeltaPct) {
    const { cm, cmPct } = this.contributionMargin(price, variableCost);
    const deltaP        = price * priceDeltaPct;         // absolute price change
    const newCM         = cm + deltaP;                   // new contribution margin
    if (newCM <= 0) return { breakeven: null, impossible: true, cm, cmPct, deltaP, newCM };
    const breakevenPct  = -deltaP / newCM;               // required volume change
    return { breakeven: breakevenPct, impossible: false, cm, cmPct, deltaP, newCM, newCMPct: newCM / (price + deltaP) };
  },

  /**
   * 9-scenario what-if table.
   * For a given price change, show P&L at 9 different volume outcomes.
   */
  scenarioTable(price, variableCost, fixedCost, priceDeltaPct, baseVolume) {
    const { breakeven } = this.breakeven(price, variableCost, priceDeltaPct);
    const newPrice      = price * (1 + priceDeltaPct);
    const newCM         = newPrice - variableCost;

    // Volume scenarios: -40% to +40% around base
    const volumeDeltas  = [-0.40, -0.30, -0.20, -0.10, 0, 0.10, 0.20, 0.30, 0.40];

    return volumeDeltas.map(vDelta => {
      const newVolume     = baseVolume * (1 + vDelta);
      const newRevenue    = newPrice * newVolume;
      const newContrib    = newCM * newVolume;
      const newProfit     = newContrib - fixedCost;
      const baseContrib   = (price - variableCost) * baseVolume;
      const baseProfit    = baseContrib - fixedCost;
      const profitDelta   = newProfit - baseProfit;
      const isBreakeven   = breakeven !== null && Math.abs(vDelta - breakeven) < 0.015;

      return {
        volumeDeltaPct: vDelta,
        newVolume,
        newRevenue,
        newContrib,
        newProfit,
        profitDelta,
        isBreakeven,
        isBetter: profitDelta > 0
      };
    });
  },

  /**
   * Breakeven curve: required volume change across price change range.
   * Range: -25% to +25% price change in 1% steps.
   */
  breakevenCurve(price, variableCost) {
    const points = [];
    for (let p = -0.25; p <= 0.25; p += 0.01) {
      const result = this.breakeven(price, variableCost, p);
      points.push({
        priceDeltaPct:    p,
        volumeDeltaPct:   result.impossible ? null : result.breakeven,
        impossible:       result.impossible
      });
    }
    return points;
  },

  /**
   * Derive price and cost from dataset if available.
   */
  deriveFromDataset(rows, schema) {
    if (!rows || !schema?.listPrice) return null;
    const prices = rows.map(r => parseFloat(r[schema.listPrice])).filter(v => v > 0);
    const costs  = schema.variableCost
      ? rows.map(r => parseFloat(r[schema.variableCost])).filter(v => v > 0)
      : [];
    return {
      avgPrice: prices.reduce((s,v) => s+v, 0) / prices.length,
      avgCost:  costs.length > 0 ? costs.reduce((s,v) => s+v, 0) / costs.length : null,
      rowCount: rows.length
    };
  }
};


// ── Module definition ─────────────────────────────────────────────────────────
window.Module_m4 = {

  _curveChart: null,
  _results:    null,

  // ── init ──────────────────────────────────────────────────────────────────
  init() {
    const pane    = document.getElementById('pane-m4');
    const derived = AppState.dataset
      ? MarginEngine.deriveFromDataset(AppState.dataset.rows, AppState.schema)
      : null;

    const defPrice    = derived?.avgPrice?.toFixed(2)  || '50.00';
    const defCost     = derived?.avgCost?.toFixed(2)   || '22.00';
    const defFixed    = '0';
    const defVolume   = derived?.rowCount || '1000';
    const defDelta    = '-5';

    pane.innerHTML = `
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-eyebrow">Diagnostic · Module 4</div>
          <div class="module-title">Margin decomposition</div>
          <div class="module-desc">Contribution margin, breakeven analysis, and what-if scenario modelling. Quantifies the volume impact of any proposed price change before committing to it.</div>
        </div>
        <div class="module-header-right">
          <span class="tag tag-phase-1">Phase 1</span>
          ${derived ? `<span class="tag" style="background:var(--teal-lt);color:var(--teal)">Values from dataset</span>` : ''}
        </div>
      </div>

      <div class="framework-callout" onclick="Module_m4._toggleFC()">
        <div class="fc-icon">◎</div>
        <div class="fc-body">
          <div class="fc-label">Framework — breakeven analysis</div>
          <div class="fc-text" id="m4-fc-text">Calculates the required volume change to maintain profitability after a price move, using the contribution margin formula: −ΔP ÷ (CM + ΔP). A 5% price cut on a 40% margin product requires a 14.3% volume increase to break even — a figure that should always precede any pricing decision.</div>
        </div>
        <div class="fc-expand" id="m4-fc-toggle">▲</div>
      </div>

      <!-- Config -->
      <div class="config-panel">
        <div class="config-panel-header">
          <div class="config-panel-title">Input parameters</div>
          <div style="font-size:10px;color:var(--tx-3)">${derived ? 'Pre-filled from dataset — adjust as needed' : 'No dataset loaded — enter manually'}</div>
        </div>
        <div class="config-row">
          <div class="config-field">
            <label class="config-label">Current price ($) <span class="required">*</span></label>
            <input class="config-input" type="number" id="m4-price" value="${defPrice}" min="0" step="0.01" oninput="Module_m4._onInput()">
            <div class="config-hint">${derived ? 'Avg list price from dataset' : 'Per unit selling price'}</div>
          </div>
          <div class="config-field">
            <label class="config-label">Variable cost ($) <span class="required">*</span></label>
            <input class="config-input" type="number" id="m4-cost" value="${defCost}" min="0" step="0.01" oninput="Module_m4._onInput()">
            <div class="config-hint">${derived ? 'Avg variable cost from dataset' : 'Per unit variable cost (COGS)'}</div>
          </div>
          <div class="config-field">
            <label class="config-label">Fixed cost ($)</label>
            <input class="config-input" type="number" id="m4-fixed" value="${defFixed}" min="0" step="100" oninput="Module_m4._onInput()">
            <div class="config-hint">Total fixed costs for the period</div>
          </div>
          <div class="config-field">
            <label class="config-label">Base volume (units)</label>
            <input class="config-input" type="number" id="m4-volume" value="${defVolume}" min="1" step="1" oninput="Module_m4._onInput()">
            <div class="config-hint">${derived ? 'Row count from dataset' : 'Current period unit volume'}</div>
          </div>
        </div>
        <div class="config-row">
          <div class="config-field">
            <label class="config-label">Proposed price change (%) <span class="required">*</span></label>
            <input class="config-input" type="number" id="m4-delta" value="${defDelta}" min="-50" max="50" step="0.5" oninput="Module_m4._onInput()">
            <div class="config-hint">Negative = price cut, positive = price increase</div>
          </div>
          <div class="config-field" style="align-self:end">
            <div style="background:var(--bg-card-2);border-radius:var(--r-md);padding:10px 12px;border:1px solid var(--border)">
              <div style="font-size:10px;color:var(--tx-3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Current CM%</div>
              <div class="stat-value" id="m4-cm-preview" style="font-size:20px;color:var(--teal)">—</div>
            </div>
          </div>
        </div>
        <div class="config-run-row">
          <button class="btn-run" onclick="Module_m4.run()">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polygon points="3,1 11,6 3,11" fill="currentColor"/></svg>
            Run analysis
          </button>
          <span class="run-hint">Updates the breakeven calculation and scenario table</span>
        </div>
      </div>

      <!-- Live CM preview -->
      <div id="m4-cm-slot"></div>

      <!-- Breakeven hero result -->
      <div id="m4-breakeven-hero" style="display:none;margin-bottom:20px">
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px;display:flex;align-items:center;gap:24px;flex-wrap:wrap">
          <div>
            <div style="font-size:10px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.07em;color:var(--tx-3);margin-bottom:6px">Required volume change to break even</div>
            <div style="display:flex;align-items:baseline;gap:10px">
              <div class="stat-value" id="m4-breakeven-pct" style="font-size:36px;color:var(--accent)">—</div>
              <div id="m4-breakeven-label" style="font-size:13px;color:var(--tx-2)"></div>
            </div>
          </div>
          <div style="width:1px;height:48px;background:var(--border);flex-shrink:0"></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;flex:1;min-width:300px">
            <div>
              <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">New price</div>
              <div style="font-size:16px;font-weight:600;font-family:'Syne',sans-serif;color:var(--tx-1)" id="m4-new-price">—</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Current CM</div>
              <div style="font-size:16px;font-weight:600;font-family:'Syne',sans-serif;color:var(--teal)" id="m4-current-cm">—</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">New CM</div>
              <div style="font-size:16px;font-weight:600;font-family:'Syne',sans-serif" id="m4-new-cm">—</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Impossible price cut warning -->
      <div id="m4-impossible" style="display:none">
        <div class="callout callout-risk" style="background:var(--red-lt);border-color:var(--red);border-radius:var(--r-md);padding:14px 16px;margin-bottom:20px">
          <strong style="color:var(--red)">Price cut eliminates contribution margin</strong>
          <div style="font-size:12px;color:var(--tx-2);margin-top:4px">The proposed price reduction would reduce the selling price below variable cost — no volume increase can recover profitability. This price is below the absolute floor.</div>
        </div>
      </div>

      <!-- Charts row -->
      <div class="output-grid" id="m4-charts" style="display:none">
        <div class="output-card">
          <div class="output-card-header">
            <div class="output-card-title">Breakeven curve</div>
            <button class="output-card-export" onclick="Module_m4.export('curve-png')">↓ PNG</button>
          </div>
          <div class="output-card-body" style="padding:12px 16px 16px">
            <canvas id="m4-curve-chart" height="220"></canvas>
          </div>
        </div>
        <div class="output-card">
          <div class="output-card-header">
            <div class="output-card-title">9-scenario what-if table</div>
            <button class="output-card-export" onclick="Module_m4.export('table-csv')">↓ CSV</button>
          </div>
          <div class="output-card-body" style="padding:0">
            <div id="m4-scenario-table"></div>
          </div>
        </div>
      </div>

      <!-- Interpretation -->
      <div id="m4-interpretation" style="display:none;margin-bottom:20px">
        <div class="output-card">
          <div class="output-card-header">
            <div class="output-card-title">Interpretation</div>
          </div>
          <div class="output-card-body" id="m4-interp-body"></div>
        </div>
      </div>

      <!-- Export bar -->
      <div class="export-bar" id="m4-export-bar" style="display:none">
        <span class="export-label">Export</span>
        <button class="export-btn" onclick="Module_m4.export('curve-png')">Breakeven curve PNG</button>
        <button class="export-btn" onclick="Module_m4.export('table-csv')">Scenario table CSV</button>
        <button class="export-btn add-to-session" onclick="Module_m4.export('session')">+ Add to session export</button>
      </div>
    `;

    // Live CM preview on input
    this._updateCMPreview();

    // Auto-run
    setTimeout(() => this.run(), 100);
  },

  // ── Live CM preview ───────────────────────────────────────────────────────
  _updateCMPreview() {
    const price = parseFloat(document.getElementById('m4-price')?.value);
    const cost  = parseFloat(document.getElementById('m4-cost')?.value);
    if (!isNaN(price) && !isNaN(cost) && price > 0) {
      const cmPct = (price - cost) / price;
      const el    = document.getElementById('m4-cm-preview');
      if (el) {
        el.textContent = UI.fmtPct(cmPct);
        el.style.color = cmPct > 0.3 ? 'var(--teal)' : cmPct > 0.15 ? 'var(--amber)' : 'var(--red)';
      }
    }
  },

  _onInput() { this._updateCMPreview(); },

  // ── run ───────────────────────────────────────────────────────────────────
  run() {
    const price      = parseFloat(document.getElementById('m4-price')?.value);
    const cost       = parseFloat(document.getElementById('m4-cost')?.value);
    const fixed      = parseFloat(document.getElementById('m4-fixed')?.value) || 0;
    const volume     = parseFloat(document.getElementById('m4-volume')?.value) || 1000;
    const deltaPct   = parseFloat(document.getElementById('m4-delta')?.value) / 100;

    if (isNaN(price) || isNaN(cost) || price <= 0) {
      Toast.warning('Enter a valid price and variable cost');
      return;
    }
    if (cost >= price) {
      Toast.warning('Variable cost exceeds price — negative margin');
    }

    const breakeven  = MarginEngine.breakeven(price, cost, deltaPct);
    const scenarios  = MarginEngine.scenarioTable(price, cost, fixed, deltaPct, volume);
    const curve      = MarginEngine.breakevenCurve(price, cost);

    const results = { price, cost, fixed, volume, deltaPct, breakeven, scenarios, curve };
    this._results = results;
    AppState.setResult('m4', results);

    this.render(results);
    Toast.success('Margin analysis complete');
  },

  // ── render ────────────────────────────────────────────────────────────────
  render(results) {
    const { price, cost, deltaPct, breakeven } = results;
    const newPrice = price * (1 + deltaPct);

    // Show/hide impossible warning
    document.getElementById('m4-impossible').style.display      = breakeven.impossible ? '' : 'none';
    document.getElementById('m4-breakeven-hero').style.display  = breakeven.impossible ? 'none' : '';
    document.getElementById('m4-charts').style.display          = '';
    document.getElementById('m4-export-bar').style.display      = '';
    document.getElementById('m4-interpretation').style.display  = '';

    if (!breakeven.impossible) {
      // Hero numbers
      const bePct = breakeven.breakeven;
      const beEl  = document.getElementById('m4-breakeven-pct');
      beEl.textContent  = UI.fmtPct(Math.abs(bePct));
      beEl.style.color  = bePct > 0 ? 'var(--amber)' : 'var(--teal)';

      document.getElementById('m4-breakeven-label').textContent =
        deltaPct < 0
          ? (bePct > 0 ? 'volume increase needed to break even' : 'volume could fall and still break even')
          : 'volume can decline and still break even';

      document.getElementById('m4-new-price').textContent   = UI.fmtCurrency(newPrice);
      document.getElementById('m4-current-cm').textContent  = UI.fmtPct(breakeven.cmPct);
      const newCMEl = document.getElementById('m4-new-cm');
      newCMEl.textContent  = UI.fmtPct(breakeven.newCMPct);
      newCMEl.style.color  = breakeven.newCMPct > breakeven.cmPct ? 'var(--teal)' : 'var(--red)';
    }

    this._renderCurve(results);
    this._renderScenarioTable(results);
    this._renderInterpretation(results);
  },

  // ── Breakeven curve ───────────────────────────────────────────────────────
  _renderCurve(results) {
    if (this._curveChart) { this._curveChart.destroy(); this._curveChart = null; }

    const points = results.curve.filter(p => !p.impossible && p.volumeDeltaPct !== null);
    const labels = points.map(p => (p.priceDeltaPct * 100).toFixed(0) + '%');
    const data   = points.map(p => (p.volumeDeltaPct * 100));

    // Mark the current proposed change
    const proposedPct = (results.deltaPct * 100).toFixed(0);
    const currentBE   = (results.breakeven.breakeven * 100);

    const ctx = document.getElementById('m4-curve-chart').getContext('2d');
    this._curveChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Required volume change',
            data,
            borderColor:     'rgba(200,169,110,0.9)',
            backgroundColor: 'rgba(200,169,110,0.08)',
            borderWidth:     2,
            pointRadius:     0,
            pointHoverRadius:4,
            fill:            true,
            tension:         0.3
          },
          {
            // Zero line reference
            label:           'Break-even line',
            data:            points.map(() => 0),
            borderColor:     'rgba(255,255,255,0.12)',
            borderWidth:     1,
            borderDash:      [4, 4],
            pointRadius:     0,
            fill:            false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: {
            callbacks: {
              title: (items) => 'Price change: ' + items[0].label,
              label: (item)  => {
                if (item.datasetIndex === 1) return null;
                const v = item.raw;
                return v > 0
                  ? 'Need ' + v.toFixed(1) + '% volume increase to break even'
                  : 'Can absorb ' + Math.abs(v).toFixed(1) + '% volume loss and still break even';
              }
            },
            backgroundColor: '#1E1E22',
            borderColor:     'rgba(255,255,255,0.1)',
            borderWidth:     1,
            titleColor:      '#F0EFEC',
            bodyColor:       '#A8A7A2',
            padding:         10,
            cornerRadius:    6
          },
          annotation: {}
        },
        scales: {
          x: {
            grid:  { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color:  '#65635E',
              font:   { size: 9, family: "'JetBrains Mono', monospace" },
              maxTicksLimit: 11,
              callback: (v, i) => labels[i] && parseInt(labels[i]) % 5 === 0 ? labels[i] : ''
            }
          },
          y: {
            grid:  { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color:    '#65635E',
              font:     { size: 10 },
              callback: (v) => v + '%'
            }
          }
        }
      }
    });
  },

  // ── Scenario table ────────────────────────────────────────────────────────
  _renderScenarioTable(results) {
    const { price, cost, deltaPct, scenarios } = results;
    const newPrice = price * (1 + deltaPct);

    const rows = scenarios.map(s => {
      const volPct     = (s.volumeDeltaPct * 100).toFixed(0);
      const arrow      = s.volumeDeltaPct < 0 ? '↓' : s.volumeDeltaPct > 0 ? '↑' : '→';
      const profitCol  = s.profitDelta >= 0 ? 'var(--teal)' : 'var(--red)';
      const rowStyle   = s.isBreakeven
        ? 'background:rgba(200,169,110,0.06);border-left:2px solid var(--accent)'
        : s.isBetter
        ? 'background:rgba(46,196,160,0.03)'
        : '';

      return `<tr style="${rowStyle}">
        <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${s.volumeDeltaPct < 0 ? 'var(--red)' : s.volumeDeltaPct > 0 ? 'var(--teal)' : 'var(--tx-2)'}">
          ${arrow} ${Math.abs(parseFloat(volPct)) === 0 ? 'No change' : Math.abs(volPct) + '%'}
          ${s.isBreakeven ? '<span style="color:var(--accent);font-size:9px;margin-left:4px">← breakeven</span>' : ''}
        </td>
        <td class="td-num">${UI.fmtNum(Math.round(s.newVolume))}</td>
        <td class="td-num">${UI.fmtCurrency(s.newRevenue, 0)}</td>
        <td class="td-num">${UI.fmtCurrency(s.newContrib, 0)}</td>
        <td class="td-num" style="color:${profitCol};font-weight:500">
          ${s.profitDelta >= 0 ? '+' : ''}${UI.fmtCurrency(s.profitDelta, 0)}
        </td>
      </tr>`;
    }).join('');

    document.getElementById('m4-scenario-table').innerHTML = `
      <div style="padding:8px 14px;background:var(--bg-card-2);border-bottom:1px solid var(--border-2);font-size:11px;color:var(--tx-3)">
        Proposed price: <strong style="color:var(--tx-1)">${UI.fmtCurrency(newPrice)}</strong>
        (${deltaPct > 0 ? '+' : ''}${(deltaPct*100).toFixed(1)}% from ${UI.fmtCurrency(price)})
      </div>
      <div class="data-table-wrap" style="border:none;border-radius:0;max-height:300px;overflow-y:auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Volume scenario</th>
              <th>Units</th>
              <th>Revenue</th>
              <th>Contribution</th>
              <th>Profit Δ</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  // ── Interpretation ────────────────────────────────────────────────────────
  _renderInterpretation(results) {
    const { price, cost, deltaPct, breakeven } = results;
    const newPrice = price * (1 + deltaPct);
    const cmPct    = breakeven.cmPct;
    const bePct    = breakeven.breakeven;
    const isPricecut = deltaPct < 0;

    let text = '';

    if (breakeven.impossible) {
      text = 'The proposed price is below variable cost — no analytical path to profitability at this price.';
    } else if (isPricecut) {
      const absChange = Math.abs(deltaPct * 100).toFixed(1);
      const absVol    = Math.abs(bePct * 100).toFixed(1);
      if (bePct > 0.20) {
        text = `A ${absChange}% price cut on a ${UI.fmtPct(cmPct)} margin requires a ${absVol}% volume increase to break even. This is a high bar — most market pricing studies suggest demand elasticity rarely generates this kind of volume response to a modest price reduction. Before proceeding, validate whether there is evidence that volume will materially increase at the lower price.`;
      } else if (bePct > 0.10) {
        text = `A ${absChange}% price cut requires a ${absVol}% volume increase to break even. This is achievable in competitive markets with high price sensitivity, but should be validated against actual demand data before implementation.`;
      } else {
        text = `A ${absChange}% price cut requires only a ${absVol}% volume increase to break even — a relatively low bar. In price-elastic markets this may be commercially defensible, but consider whether the price reduction is recoverable if volume does not respond as expected.`;
      }
    } else {
      const absChange = Math.abs(deltaPct * 100).toFixed(1);
      const absVol    = Math.abs(bePct * 100).toFixed(1);
      text = `A ${absChange}% price increase can absorb a ${absVol}% volume decline and still break even. This is the key question: will the price increase cause more than ${absVol}% customer attrition? If the market or customer relationship can support this increase, the margin improvement is immediate and compounds at scale.`;
    }

    document.getElementById('m4-interp-body').innerHTML = `
      <div style="font-size:13px;color:var(--tx-2);line-height:1.8;padding:4px 0">${text}</div>
    `;
  },

  // ── Export ────────────────────────────────────────────────────────────────
  export(format) {
    if (!this._results) { Toast.warning('Run the analysis first'); return; }

    if (format === 'curve-png') {
      const canvas = document.getElementById('m4-curve-chart');
      const link   = document.createElement('a');
      link.download = 'breakeven-curve.png';
      link.href     = canvas.toDataURL('image/png');
      link.click();
      Toast.success('Breakeven curve exported');
    }

    if (format === 'table-csv') {
      const { price, cost, deltaPct, scenarios } = this._results;
      const newPrice = price * (1 + deltaPct);
      const headers  = ['volume_scenario_pct','new_volume','new_revenue','new_contribution','profit_delta'];
      const rows     = scenarios.map(s => [
        (s.volumeDeltaPct * 100).toFixed(1) + '%',
        Math.round(s.newVolume),
        s.newRevenue.toFixed(2),
        s.newContrib.toFixed(2),
        s.profitDelta.toFixed(2)
      ].join(','));
      const csv = [
        '# Breakeven scenario table',
        '# Current price: ' + price + ' | Proposed: ' + newPrice.toFixed(2) + ' | Change: ' + (deltaPct*100).toFixed(1) + '%',
        headers.join(','),
        ...rows
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'breakeven-scenarios.csv';
      link.href     = URL.createObjectURL(blob);
      link.click();
      Toast.success('Scenario table exported');
    }

    if (format === 'session') {
      AppState.setResult('m4', this._results);
      Toast.success('Added to session export');
    }
  },

  _toggleFC() {
    const text   = document.getElementById('m4-fc-text');
    const toggle = document.getElementById('m4-fc-toggle');
    const hidden = text.style.display === 'none';
    text.style.display = hidden ? '' : 'none';
    toggle.textContent = hidden ? '▲' : '▼';
  }
};
