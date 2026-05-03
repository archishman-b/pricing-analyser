/**
 * M2 — Price Band Analysis
 * ─────────────────────────────────────────────────────────────────────────────
 * OLS regression of discount % against legitimate factors (volume, region,
 * tier) to surface unwarranted discounting. Plots actual vs peer prices,
 * identifies outliers, quantifies recoverable margin.
 *
 * Computation runs synchronously for datasets < 10K rows.
 * math.js used for matrix operations.
 */

'use strict';

// ── Regression engine ─────────────────────────────────────────────────────────
const RegressionEngine = {

  /**
   * Encode categorical column into numeric dummy variables.
   * Returns { encoded: number[][], labels: string[] }
   */
  encodeCategorical(values) {
    const unique = [...new Set(values)].sort();
    // Drop first category (reference) to avoid multicollinearity
    const dummies = unique.slice(1);
    return {
      encoded: values.map(v => dummies.map(d => v === d ? 1 : 0)),
      labels:  dummies.map(d => '(' + d + ')')
    };
  },

  /**
   * Build design matrix X from rows and factor definitions.
   * factors: [{ column, type: 'numeric'|'categorical' }]
   */
  buildDesignMatrix(rows, factors) {
    const colArrays = []; // each element is an array of values for one predictor
    const labels    = ['intercept'];

    factors.forEach(f => {
      const vals = rows.map(r => r[f.column]);
      if (f.type === 'numeric') {
        const nums = vals.map(v => parseFloat(v) || 0);
        colArrays.push(nums);
        labels.push(f.column);
      } else {
        const { encoded, labels: dLabels } = this.encodeCategorical(vals.map(String));
        // Each dummy is a separate predictor
        const nDummies = dLabels.length;
        for (let d = 0; d < nDummies; d++) {
          colArrays.push(encoded.map(row => row[d]));
          labels.push(f.column + dLabels[d]);
        }
      }
    });

    // Build X: n x (1 + p) matrix with intercept column
    const n = rows.length;
    const X = rows.map((_, i) => [1, ...colArrays.map(col => col[i])]);
    return { X, labels };
  },

  /**
   * Ordinary Least Squares via normal equations: β = (XᵀX)⁻¹Xᵀy
   * Returns { beta, fitted, residuals, r2, stdDev, conditionNumber }
   */
  ols(X, y) {
    try {
      const Xm   = math.matrix(X);
      const ym   = math.matrix(y);
      const Xt   = math.transpose(Xm);
      const XtX  = math.multiply(Xt, Xm);

      // Condition number check — guard against multicollinearity
      const det  = math.det(XtX);
      if (Math.abs(det) < 1e-10) {
        return { error: 'Matrix is singular or nearly singular — factors may be collinear. Try removing one or more factors.' };
      }

      const XtXinv = math.inv(XtX);
      const beta   = math.multiply(math.multiply(XtXinv, Xt), ym);
      const betaArr= math.flatten(beta).toArray ? math.flatten(beta).toArray() : Array.from(beta._data || beta);

      const fitted   = X.map(row => row.reduce((s, v, i) => s + v * betaArr[i], 0));
      const residuals= y.map((v, i) => v - fitted[i]);
      const yMean    = y.reduce((s, v) => s + v, 0) / y.length;
      const ssTot    = y.reduce((s, v) => s + Math.pow(v - yMean, 2), 0);
      const ssRes    = residuals.reduce((s, v) => s + v * v, 0);
      const r2       = ssTot > 0 ? 1 - ssRes / ssTot : 0;
      const stdDev   = Math.sqrt(ssRes / Math.max(y.length - betaArr.length, 1));

      return { beta: betaArr, fitted, residuals, r2, stdDev, n: y.length, error: null };

    } catch (err) {
      return { error: 'Regression failed: ' + err.message };
    }
  },

  /**
   * Full price band analysis pipeline.
   */
  run(rows, schema, factors) {
    if (!rows || rows.length < 10) return { error: 'Need at least 10 rows for regression' };
    if (!schema.listPrice || !schema.invoicePrice) return { error: 'List price and invoice price columns required' };

    // Compute discount % as target variable
    const withDiscount = rows.map(r => {
      const list    = parseFloat(r[schema.listPrice]);
      const invoice = parseFloat(r[schema.invoicePrice]);
      if (!list || !invoice || list <= 0) return null;
      const discPct = (list - invoice) / list;
      return { ...r, _discPct: discPct, _list: list, _invoice: invoice };
    }).filter(r => r !== null && r._discPct >= 0 && r._discPct < 1);

    if (withDiscount.length < 10) return { error: 'Insufficient valid rows after filtering (need 10+)' };

    const y = withDiscount.map(r => r._discPct);

    // Build design matrix
    const { X, labels } = this.buildDesignMatrix(withDiscount, factors);

    // Run OLS
    const ols = this.ols(X, y);
    if (ols.error) return { error: ols.error };

    const { fitted, residuals, r2, stdDev } = ols;

    // Peer prices: list * (1 - fitted_discount)
    const peerPrices  = withDiscount.map((r, i) => r._list * (1 - fitted[i]));
    const upperBand   = withDiscount.map((r, i) => r._list * (1 - (fitted[i] - stdDev)));
    const lowerBand   = withDiscount.map((r, i) => r._list * (1 - (fitted[i] + stdDev)));

    // Outliers: residual > 1 SD below fitted (over-discounted)
    const outliers = withDiscount.map((r, i) => ({
      ...r,
      _fitted:      fitted[i],
      _residual:    residuals[i],
      _peerPrice:   peerPrices[i],
      _upperBand:   upperBand[i],
      _lowerBand:   lowerBand[i],
      _isOutlier:   residuals[i] > stdDev,           // over-discounted (above band)
      _isPremium:   residuals[i] < -stdDev,           // under-discounted (below band)
      _excess:      Math.max(0, residuals[i]) * r._list  // $ excess discount
    }));

    const outliersOnly = outliers.filter(r => r._isOutlier);
    const recoverableMargin = outliersOnly.reduce((s, r) => s + r._excess, 0);

    // Summary stats
    const avgDiscount = y.reduce((s, v) => s + v, 0) / y.length;
    const outPct = outliersOnly.length / withDiscount.length;

    // Rep-level breakdown if rep column present
    let repBreakdown = [];
    if (schema.salesRep) {
      const repGroups = {};
      outliers.forEach(r => {
        const rep = r[schema.salesRep] || 'Unknown';
        if (!repGroups[rep]) repGroups[rep] = { total: 0, outliers: 0, recovery: 0 };
        repGroups[rep].total++;
        if (r._isOutlier) { repGroups[rep].outliers++; repGroups[rep].recovery += r._excess; }
      });
      repBreakdown = Object.entries(repGroups)
        .map(([rep, d]) => ({ rep, total: d.total, outliers: d.outliers, recovery: d.recovery, violationRate: d.outliers / d.total }))
        .sort((a, b) => b.recovery - a.recovery);
    }

    return {
      rows:      outliers,
      r2,
      stdDev,
      avgDiscount,
      outliersOnly,
      outPct,
      recoverableMargin,
      repBreakdown,
      labels,
      beta:      ols.beta,
      n:         withDiscount.length,
      error:     null
    };
  }
};


// ── Module definition ─────────────────────────────────────────────────────────
window.Module_m2 = {

  _scatterChart: null,
  _results:      null,
  _sortCol:      'recovery',
  _sortDir:      -1,

  // ── init ──────────────────────────────────────────────────────────────────
  init() {
    const pane   = document.getElementById('pane-m2');
    const schema = AppState.schema || {};
    const cols   = AppState.dataset?.columns || [];

    // Detect numeric and categorical columns for factor selection
    const numericCols = cols.filter(c => {
      const sample = AppState.dataset?.rows?.slice(0, 10).map(r => r[c]).filter(v => v != null);
      return sample && sample.every(v => !isNaN(parseFloat(v)));
    });
    const catCols = cols.filter(c => !numericCols.includes(c));

    pane.innerHTML = `
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-eyebrow">Diagnostic · Module 2</div>
          <div class="module-title">Price band analysis</div>
          <div class="module-desc">OLS regression of discount % against legitimate factors to identify unwarranted discounting. Surfaces accounts outside the expected price band and quantifies recoverable margin.</div>
        </div>
        <div class="module-header-right">
          <span class="tag tag-phase-2">Phase 2</span>
        </div>
      </div>

      <div class="framework-callout" onclick="Module_m2._toggleFC()">
        <div class="fc-icon">◎</div>
        <div class="fc-body">
          <div class="fc-label">Framework — price band regression</div>
          <div class="fc-text" id="m2-fc-text">Plots actual prices against statistically-derived peer prices to identify customers receiving discounts beyond what volume, region, or tier would justify. An R² below 0.4 signals that discounting is largely random — not policy-driven. The outliers above the band are the recoverable margin opportunity.</div>
        </div>
        <div class="fc-expand">▲</div>
      </div>

      <div class="config-panel" id="m2-config">
        <div class="config-panel-header">
          <div class="config-panel-title">Regression factors</div>
          <div style="font-size:10px;color:var(--tx-3)">Select legitimate reasons for discount variation</div>
        </div>

        <div style="margin-bottom:12px">
          <div class="config-label" style="margin-bottom:8px">Numeric factors (e.g. volume, order size)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px" id="m2-numeric-factors">
            ${numericCols.filter(c => c !== schema.listPrice && c !== schema.invoicePrice && c !== schema.variableCost)
              .map(c => `
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--tx-2);cursor:pointer;
                background:var(--bg-card-2);border:1px solid var(--border);border-radius:var(--r-sm);padding:4px 9px">
                <input type="checkbox" value="${c}" data-type="numeric"
                  ${c === schema.quantity ? 'checked' : ''}
                  style="accent-color:var(--accent)"> ${c}
              </label>`).join('')}
          </div>
        </div>

        <div style="margin-bottom:12px">
          <div class="config-label" style="margin-bottom:8px">Categorical factors (e.g. region, tier, product)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px" id="m2-cat-factors">
            ${catCols.filter(c => c !== schema.salesRep && c !== 'transaction_id' && c !== 'customer_id' && c !== 'date')
              .map(c => `
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--tx-2);cursor:pointer;
                background:var(--bg-card-2);border:1px solid var(--border);border-radius:var(--r-sm);padding:4px 9px">
                <input type="checkbox" value="${c}" data-type="categorical"
                  ${(c === schema.region || c === schema.customerTier) ? 'checked' : ''}
                  style="accent-color:var(--accent)"> ${c}
              </label>`).join('')}
          </div>
        </div>

        <div class="config-run-row">
          <button class="btn-run" onclick="Module_m2.run()">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polygon points="3,1 11,6 3,11" fill="currentColor"/></svg>
            Run regression
          </button>
          <span class="run-hint" id="m2-run-hint">Select at least one factor then run</span>
        </div>
      </div>

      <!-- R² quality indicator -->
      <div id="m2-r2-banner" style="display:none;margin-bottom:16px"></div>

      <!-- Stat cards -->
      <div class="stat-row" id="m2-stats" style="display:none">
        <div class="stat-card">
          <div class="stat-label">R² — model fit</div>
          <div class="stat-value" id="m2-stat-r2" style="color:var(--accent)">—</div>
          <div class="stat-sub" id="m2-stat-r2-label">higher = more explained by factors</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Outlier accounts</div>
          <div class="stat-value" id="m2-stat-outliers" style="color:var(--red)">—</div>
          <div class="stat-sub" id="m2-stat-outlier-pct">above the price band</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Recoverable margin</div>
          <div class="stat-value" id="m2-stat-recovery" style="color:var(--teal)">—</div>
          <div class="stat-sub">if outliers pulled to band</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Rows analysed</div>
          <div class="stat-value" id="m2-stat-n" style="color:var(--tx-1)">—</div>
          <div class="stat-sub">after filtering</div>
        </div>
      </div>

      <!-- Charts row -->
      <div class="output-grid" id="m2-charts" style="display:none">
        <div class="output-card" style="grid-column:1/-1">
          <div class="output-card-header">
            <div class="output-card-title">Actual vs peer price — price band scatter</div>
            <button class="output-card-export" onclick="Module_m2.export('scatter-png')">↓ PNG</button>
          </div>
          <div class="output-card-body" style="padding:12px 16px 16px">
            <canvas id="m2-scatter-chart" height="280"></canvas>
          </div>
        </div>
      </div>

      <!-- Outlier table -->
      <div class="output-card" id="m2-table-card" style="display:none;margin-bottom:20px">
        <div class="output-card-header">
          <div class="output-card-title" id="m2-table-title">Outlier accounts — over-discounted</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="display:flex;gap:4px">
              <button onclick="Module_m2._setView('outliers')" id="m2-view-outliers"
                style="font-size:10px;padding:3px 9px;border-radius:3px;border:1px solid var(--accent);background:var(--accent-lt);color:var(--accent);cursor:pointer;font-family:inherit">
                Outliers
              </button>
              <button onclick="Module_m2._setView('all')" id="m2-view-all"
                style="font-size:10px;padding:3px 9px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);cursor:pointer;font-family:inherit">
                All
              </button>
            </div>
            <button class="output-card-export" onclick="Module_m2.export('outliers-csv')">↓ CSV</button>
          </div>
        </div>
        <div class="output-card-body" style="padding:0">
          <div class="data-table-wrap" style="border:none;border-radius:0">
            <table class="data-table">
              <thead id="m2-thead"></thead>
              <tbody id="m2-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Rep breakdown -->
      <div class="output-card" id="m2-rep-card" style="display:none;margin-bottom:20px">
        <div class="output-card-header">
          <div class="output-card-title">Outlier recovery — by sales rep</div>
          <button class="output-card-export" onclick="Module_m2.export('rep-csv')">↓ CSV</button>
        </div>
        <div class="output-card-body" style="padding:0">
          <table class="data-table" id="m2-rep-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>Total transactions</th>
                <th>Outlier count</th>
                <th>Violation rate</th>
                <th>Recoverable $</th>
              </tr>
            </thead>
            <tbody id="m2-rep-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Export bar -->
      <div class="export-bar" id="m2-export-bar" style="display:none">
        <span class="export-label">Export</span>
        <button class="export-btn" onclick="Module_m2.export('scatter-png')">Scatter chart PNG</button>
        <button class="export-btn" onclick="Module_m2.export('outliers-csv')">Outlier table CSV</button>
        <button class="export-btn" onclick="Module_m2.export('rep-csv')">Rep breakdown CSV</button>
        <button class="export-btn add-to-session" onclick="Module_m2.export('session')">+ Add to session export</button>
      </div>
    `;
  },

  // ── run ───────────────────────────────────────────────────────────────────
  run() {
    // Collect selected factors
    const factors = [];
    document.querySelectorAll('#m2-numeric-factors input:checked, #m2-cat-factors input:checked').forEach(cb => {
      factors.push({ column: cb.value, type: cb.dataset.type });
    });

    if (factors.length === 0) {
      Toast.warning('Select at least one regression factor');
      return;
    }

    if (!AppState.dataset || !AppState.schema) {
      Toast.warning('Load and map a dataset first');
      return;
    }

    document.getElementById('m2-run-hint').textContent = 'Running regression…';

    // Run (slightly deferred to allow UI to update)
    setTimeout(() => {
      const results = RegressionEngine.run(
        AppState.dataset.rows,
        AppState.schema,
        factors
      );

      if (results.error) {
        Toast.error(results.error);
        document.getElementById('m2-run-hint').textContent = 'Error — ' + results.error;
        return;
      }

      this._results = results;
      AppState.setResult('m2', results);
      this.render(results);
      Toast.success('Regression complete — R² = ' + results.r2.toFixed(3));
    }, 50);
  },

  // ── render ────────────────────────────────────────────────────────────────
  render(results) {
    const { r2, stdDev, outliersOnly, outPct, recoverableMargin, n } = results;

    // R² banner
    const r2Banner = document.getElementById('m2-r2-banner');
    r2Banner.style.display = '';
    const r2Class = r2 >= 0.5 ? 'good' : r2 >= 0.3 ? 'warn' : 'bad';
    const r2Msg   = r2 >= 0.5
      ? 'Strong model fit — discount variation is largely explained by the selected factors'
      : r2 >= 0.3
      ? 'Moderate fit — some discount variation is explained, but residual randomness remains'
      : 'Weak fit — discounting appears largely random, not driven by the selected factors. This may indicate unmanaged discretionary discounting.';

    r2Banner.innerHTML = `<div class="quality-banner ${r2Class}">
      <div class="quality-score">${r2.toFixed(2)}</div>
      <div class="quality-body">
        <div class="quality-title">R² — ${r2 >= 0.5 ? 'strong' : r2 >= 0.3 ? 'moderate' : 'weak'} model fit</div>
        <div class="quality-desc">${r2Msg}</div>
      </div>
    </div>`;

    // Stat cards
    document.getElementById('m2-stats').style.display     = '';
    document.getElementById('m2-stat-r2').textContent     = r2.toFixed(3);
    document.getElementById('m2-stat-r2').style.color     = r2 >= 0.5 ? 'var(--teal)' : r2 >= 0.3 ? 'var(--amber)' : 'var(--red)';
    document.getElementById('m2-stat-outliers').textContent = UI.fmtNum(outliersOnly.length);
    document.getElementById('m2-stat-outlier-pct').textContent = UI.fmtPct(outPct) + ' of transactions';
    document.getElementById('m2-stat-recovery').textContent = UI.fmtCurrency(recoverableMargin);
    document.getElementById('m2-stat-n').textContent      = UI.fmtNum(n);

    // Show output sections
    document.getElementById('m2-charts').style.display     = '';
    document.getElementById('m2-table-card').style.display = '';
    document.getElementById('m2-export-bar').style.display = '';

    this._renderScatter(results);
    this._renderTable(results, 'outliers');

    if (results.repBreakdown.length > 0) {
      document.getElementById('m2-rep-card').style.display = '';
      this._renderRepTable(results);
    }
  },

  // ── Scatter chart ─────────────────────────────────────────────────────────
  _renderScatter(results) {
    if (this._scatterChart) { this._scatterChart.destroy(); this._scatterChart = null; }

    const rows = results.rows;
    // Sample for performance: max 800 points
    const sample = rows.length > 800
      ? rows.filter((_, i) => i % Math.ceil(rows.length / 800) === 0)
      : rows;

    const inBand   = sample.filter(r => !r._isOutlier && !r._isPremium);
    const outliers = sample.filter(r => r._isOutlier);
    const premiums = sample.filter(r => r._isPremium);

    // x = peer price, y = actual invoice price
    const ctx = document.getElementById('m2-scatter-chart').getContext('2d');
    this._scatterChart = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Within band',
            data: inBand.map(r => ({ x: r._peerPrice, y: r._invoice })),
            backgroundColor: 'rgba(46,196,160,0.35)',
            borderColor:     'rgba(46,196,160,0.6)',
            pointRadius:     3,
            pointHoverRadius:5
          },
          {
            label: 'Over-discounted (outlier)',
            data: outliers.map(r => ({ x: r._peerPrice, y: r._invoice })),
            backgroundColor: 'rgba(224,92,92,0.5)',
            borderColor:     'rgba(224,92,92,0.8)',
            pointRadius:     4,
            pointHoverRadius:6
          },
          {
            label: 'Under-discounted',
            data: premiums.map(r => ({ x: r._peerPrice, y: r._invoice })),
            backgroundColor: 'rgba(91,156,246,0.35)',
            borderColor:     'rgba(91,156,246,0.6)',
            pointRadius:     3,
            pointHoverRadius:5
          },
          {
            // Perfect fit line (y = x)
            label: 'Peer price (fitted)',
            data: (() => {
              const prices = rows.map(r => r._peerPrice);
              const min = Math.min(...prices); const max = Math.max(...prices);
              return [{ x: min, y: min }, { x: max, y: max }];
            })(),
            type: 'line',
            borderColor:  'rgba(200,169,110,0.7)',
            borderWidth:  1.5,
            borderDash:   [5, 5],
            pointRadius:  0,
            fill:         false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { color: '#A8A7A2', font: { size: 10 }, boxWidth: 10, padding: 14 }
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                if (item.datasetIndex === 3) return null;
                return `Peer: ${UI.fmtCurrency(item.raw.x)} · Actual: ${UI.fmtCurrency(item.raw.y)}`;
              }
            },
            backgroundColor: '#1E1E22',
            borderColor:     'rgba(255,255,255,0.1)',
            borderWidth:      1,
            titleColor:       '#F0EFEC',
            bodyColor:        '#A8A7A2',
            padding:          10,
            cornerRadius:     6
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Peer price ($)', color: '#65635E', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#65635E', font: { size: 10 }, callback: v => '$' + v.toFixed(0) }
          },
          y: {
            title: { display: true, text: 'Actual invoice price ($)', color: '#65635E', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#65635E', font: { size: 10 }, callback: v => '$' + v.toFixed(0) }
          }
        }
      }
    });
  },

  // ── Outlier table ─────────────────────────────────────────────────────────
  _setView(view) {
    this._currentView = view;
    ['outliers', 'all'].forEach(v => {
      const btn = document.getElementById('m2-view-' + v);
      if (btn) {
        btn.style.background    = v === view ? 'var(--accent-lt)' : 'transparent';
        btn.style.borderColor   = v === view ? 'var(--accent)'    : 'var(--border)';
        btn.style.color         = v === view ? 'var(--accent)'    : 'var(--tx-3)';
      }
    });
    if (this._results) this._renderTable(this._results, view);
  },

  _renderTable(results, view) {
    const schema = AppState.schema;
    const idCol  = 'transaction_id';
    const rows   = view === 'outliers' ? results.outliersOnly : results.rows;

    document.getElementById('m2-table-title').textContent = view === 'outliers'
      ? `Outlier accounts — over-discounted (${rows.length} of ${results.n})`
      : `All accounts (${rows.length})`;

    // Header
    document.getElementById('m2-thead').innerHTML = `<tr>
      <th>Account</th>
      ${schema.salesRep ? '<th>Rep</th>' : ''}
      ${schema.region   ? '<th>Region</th>' : ''}
      <th onclick="Module_m2._sort('_invoice')" class="${this._sortCol==='_invoice'?'sorted':''}">Actual price ${this._sortCol==='_invoice'?(this._sortDir>0?'↑':'↓'):''}</th>
      <th onclick="Module_m2._sort('_peerPrice')" class="${this._sortCol==='_peerPrice'?'sorted':''}">Peer price ${this._sortCol==='_peerPrice'?(this._sortDir>0?'↑':'↓'):''}</th>
      <th onclick="Module_m2._sort('_excess')" class="${this._sortCol==='_excess'?'sorted':''}">Excess discount $ ${this._sortCol==='_excess'?(this._sortDir>0?'↑':'↓'):''}</th>
      <th onclick="Module_m2._sort('_discPct')" class="${this._sortCol==='_discPct'?'sorted':''}">Discount % ${this._sortCol==='_discPct'?(this._sortDir>0?'↑':'↓'):''}</th>
      <th>Status</th>
    </tr>`;

    // Sort
    const sorted = [...rows].sort((a, b) => {
      return (a[this._sortCol] - b[this._sortCol]) * this._sortDir;
    });

    const display = sorted.slice(0, 200);
    document.getElementById('m2-tbody').innerHTML = display.map(r => `
      <tr>
        <td style="color:${r._isOutlier ? 'var(--red)' : 'var(--tx-1)'}">${r[idCol] || r.customer_id || '—'}</td>
        ${schema.salesRep ? `<td style="color:var(--tx-2)">${r[schema.salesRep] || '—'}</td>` : ''}
        ${schema.region   ? `<td style="color:var(--tx-2)">${r[schema.region] || '—'}</td>` : ''}
        <td class="td-num">${UI.fmtCurrency(r._invoice)}</td>
        <td class="td-num" style="color:var(--accent)">${UI.fmtCurrency(r._peerPrice)}</td>
        <td class="td-num" style="color:${r._excess > 0 ? 'var(--red)' : 'var(--teal)'}">
          ${r._excess > 0 ? '+' + UI.fmtCurrency(r._excess) : '—'}
        </td>
        <td class="td-pct">${UI.fmtPct(r._discPct)}</td>
        <td>
          <span style="font-size:10px;padding:2px 7px;border-radius:3px;font-weight:500;
            background:${r._isOutlier ? 'var(--red-lt)' : r._isPremium ? 'var(--blue-lt)' : 'var(--teal-lt)'};
            color:${r._isOutlier ? 'var(--red)' : r._isPremium ? 'var(--blue)' : 'var(--teal)'}">
            ${r._isOutlier ? 'Outlier' : r._isPremium ? 'Premium' : 'In band'}
          </span>
        </td>
      </tr>`).join('');

    if (sorted.length > 200) {
      document.getElementById('m2-tbody').innerHTML += `<tr><td colspan="8" style="text-align:center;color:var(--tx-3);font-size:11px;padding:10px">
        Showing 200 of ${sorted.length.toLocaleString()} rows — export CSV for full dataset
      </td></tr>`;
    }
  },

  _renderRepTable(results) {
    document.getElementById('m2-rep-tbody').innerHTML = results.repBreakdown.map(r => `
      <tr>
        <td style="color:var(--tx-1);font-weight:500">${r.rep}</td>
        <td class="td-num">${UI.fmtNum(r.total)}</td>
        <td class="td-num" style="color:${r.outliers > 0 ? 'var(--red)' : 'var(--teal)'}">${UI.fmtNum(r.outliers)}</td>
        <td class="td-pct" style="color:${r.violationRate > 0.2 ? 'var(--red)' : r.violationRate > 0.1 ? 'var(--amber)' : 'var(--teal)'}">
          ${UI.fmtPct(r.violationRate)}
        </td>
        <td class="td-num" style="color:${r.recovery > 0 ? 'var(--teal)' : 'var(--tx-3)'}">
          ${r.recovery > 0 ? UI.fmtCurrency(r.recovery) : '—'}
        </td>
      </tr>`).join('');
  },

  // ── Export ────────────────────────────────────────────────────────────────
  export(format) {
    if (!this._results) { Toast.warning('Run the regression first'); return; }

    if (format === 'scatter-png') {
      const canvas = document.getElementById('m2-scatter-chart');
      const link = document.createElement('a');
      link.download = 'price-band-scatter.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      Toast.success('Scatter chart exported');
    }

    if (format === 'outliers-csv') {
      const schema = AppState.schema;
      const rows   = this._results.outliersOnly;
      const headers = ['transaction_id', schema.salesRep, schema.region, 'invoice_price', 'peer_price', 'excess_discount', 'discount_pct', 'status'].filter(Boolean);
      const csv = [headers.join(','), ...rows.map(r => [
        r['transaction_id'] || r.customer_id || '',
        schema.salesRep ? (r[schema.salesRep] || '') : null,
        schema.region   ? (r[schema.region] || '')   : null,
        r._invoice.toFixed(2),
        r._peerPrice.toFixed(2),
        r._excess.toFixed(2),
        (r._discPct * 100).toFixed(2) + '%',
        r._isOutlier ? 'outlier' : r._isPremium ? 'premium' : 'in_band'
      ].filter(v => v !== null).join(','))].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'price-band-outliers.csv';
      link.href = URL.createObjectURL(blob);
      link.click();
      Toast.success('Outlier table exported');
    }

    if (format === 'rep-csv') {
      const headers = ['rep', 'total', 'outliers', 'violation_rate', 'recoverable'];
      const csv = [headers.join(','), ...this._results.repBreakdown.map(r =>
        [r.rep, r.total, r.outliers, (r.violationRate * 100).toFixed(1) + '%', r.recovery.toFixed(2)].join(',')
      )].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'rep-outlier-breakdown.csv';
      link.href = URL.createObjectURL(blob);
      link.click();
      Toast.success('Rep breakdown exported');
    }

    if (format === 'session') {
      AppState.setResult('m2', this._results);
      Toast.success('Added to session export');
    }
  },

  _sort(col) {
    if (this._sortCol === col) this._sortDir *= -1;
    else { this._sortCol = col; this._sortDir = -1; }
    if (this._results) this._renderTable(this._results, this._currentView || 'outliers');
  },

  _toggleFC() {
    const text   = document.getElementById('m2-fc-text');
    const hidden = text.style.display === 'none';
    text.style.display = hidden ? '' : 'none';
  }
};
