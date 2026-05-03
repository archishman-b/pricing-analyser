/**
 * M1 — Price Waterfall & Pocket Price
 * ─────────────────────────────────────────────────────────────────────────────
 * Operationalises the price waterfall framework: maps every discount and
 * concession between list price and pocket price, identifies leakage sources,
 * and quantifies margin recovery opportunity.
 *
 * Implements: init(), run(dataset, config), render(results), export(format)
 */

'use strict';

// ── Waterfall computation engine ─────────────────────────────────────────────
const WaterfallEngine = {

  /**
   * Core computation: for each row, step through discount layers
   * and produce pocket price + per-layer deductions.
   */
  compute(rows, schema, layers, floorPrice) {
    if (!rows || rows.length === 0) return null;

    const results = rows.map(row => {
      const listPrice = parseFloat(row[schema.listPrice]) || 0;
      if (listPrice <= 0) return null;

      let running = listPrice;
      const steps = [{ label: 'List price', value: listPrice, deduction: 0, running: listPrice }];

      layers.forEach(layer => {
        const raw = parseFloat(row[layer.column]);
        if (isNaN(raw)) { steps.push({ label: layer.name, value: 0, deduction: 0, running, skipped: true }); return; }
        const deduction = layer.type === 'percent' ? listPrice * raw : raw;
        running = Math.max(0, running - deduction);
        steps.push({ label: layer.name, value: raw, deduction, running, type: layer.type });
      });

      const pocketPrice   = running;
      const totalLeakage  = listPrice - pocketPrice;
      const leakagePct    = listPrice > 0 ? totalLeakage / listPrice : 0;
      const belowFloor    = floorPrice > 0 && pocketPrice < floorPrice;

      return {
        ...row,
        _listPrice:   listPrice,
        _pocketPrice: pocketPrice,
        _leakage:     totalLeakage,
        _leakagePct:  leakagePct,
        _belowFloor:  belowFloor,
        _steps:       steps
      };
    }).filter(Boolean);

    // ── Summary stats ──
    const n            = results.length;
    const avgList      = results.reduce((s, r) => s + r._listPrice, 0) / n;
    const avgPocket    = results.reduce((s, r) => s + r._pocketPrice, 0) / n;
    const totalLeakage = results.reduce((s, r) => s + r._leakage, 0);
    const avgLeakagePct = (avgList - avgPocket) / avgList;
    const belowFloorCount = results.filter(r => r._belowFloor).length;

    // ── Per-layer breakdown ──
    const layerBreakdown = layers.map((layer, i) => {
      const deductions = results.map(r => r._steps[i + 1]?.deduction || 0);
      const total      = deductions.reduce((s, d) => s + d, 0);
      const avg        = total / n;
      const pctOfList  = avg / avgList;
      return { name: layer.name, column: layer.column, total, avg, pctOfList, count: deductions.filter(d => d > 0).length };
    }).sort((a, b) => b.total - a.total);

    // ── Quantity-weighted pocket price (if qty column present) ──
    let weightedPocket = null;
    if (schema.quantity) {
      const totalRev = results.reduce((s, r) => s + (r._pocketPrice * (parseFloat(r[schema.quantity]) || 1)), 0);
      const totalQty = results.reduce((s, r) => s + (parseFloat(r[schema.quantity]) || 1), 0);
      weightedPocket = totalRev / totalQty;
    }

    // ── Recoverable margin estimate (pull below-floor accounts to floor) ──
    let recoverableMargin = 0;
    if (floorPrice > 0) {
      recoverableMargin = results
        .filter(r => r._belowFloor)
        .reduce((s, r) => s + (floorPrice - r._pocketPrice), 0);
    }

    // ── Segment breakdown (if segmentBy column present) ──
    const segments = {};

    return {
      rows: results,
      summary: {
        n,
        avgList,
        avgPocket,
        totalLeakage,
        avgLeakagePct,
        weightedPocket,
        belowFloorCount,
        recoverableMargin
      },
      layerBreakdown,
      segments
    };
  },

  /**
   * Compute segment-level summaries.
   */
  computeSegments(results, segmentCol) {
    if (!segmentCol) return {};
    const groups = {};
    results.rows.forEach(r => {
      const key = r[segmentCol] || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    const out = {};
    Object.entries(groups).forEach(([key, rows]) => {
      const n          = rows.length;
      const avgList    = rows.reduce((s, r) => s + r._listPrice, 0) / n;
      const avgPocket  = rows.reduce((s, r) => s + r._pocketPrice, 0) / n;
      const leakagePct = avgList > 0 ? (avgList - avgPocket) / avgList : 0;
      out[key] = { n, avgList, avgPocket, leakagePct };
    });
    return out;
  }
};


// ── Module definition ─────────────────────────────────────────────────────────
window.Module_m1 = {

  _chart:       null,
  _segChart:    null,
  _results:     null,
  _sortCol:     '_leakage',
  _sortDir:     -1,
  _filterText:  '',
  _segmentBy:   '',
  _drillRow:    null,

  // ── init ──────────────────────────────────────────────────────────────────
  init() {
    const pane = document.getElementById('pane-m1');
    const schema = AppState.schema;
    const layers = schema?.discountLayers || [];

    pane.innerHTML = `
      <!-- Module header -->
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-eyebrow">Diagnostic · Module 1</div>
          <div class="module-title">Price waterfall</div>
          <div class="module-desc">Maps every discount and concession between list price and pocket price. Identifies profit leakage sources and quantifies their magnitude across the customer portfolio.</div>
        </div>
        <div class="module-header-right">
          <span class="tag tag-phase-1">Phase 1</span>
        </div>
      </div>

      <!-- Framework callout -->
      <div class="framework-callout" id="m1-fc" onclick="Module_m1._toggleFC()">
        <div class="fc-icon">◎</div>
        <div class="fc-body">
          <div class="fc-label">Framework — price waterfall analysis</div>
          <div class="fc-text" id="m1-fc-text">Maps the cascade from list price to pocket price, surfacing every discount layer and concession that erodes margin between invoice and cash receipt. The pocket price band — the spread between the highest and lowest pocket prices in the portfolio — reveals the true range of prices being received, often far wider than management believes.</div>
        </div>
        <div class="fc-expand" id="m1-fc-toggle">▲</div>
      </div>

      <!-- Config panel -->
      <div class="config-panel" id="m1-config">
        <div class="config-panel-header">
          <div class="config-panel-title">Waterfall configuration</div>
          <button class="config-collapse-btn" onclick="Module_m1._toggleConfig()">collapse ▲</button>
        </div>

        <div class="config-row">
          <div class="config-field">
            <label class="config-label">List price column <span class="required">*</span></label>
            <select class="config-select" id="m1-list-col" onchange="Module_m1._onConfigChange()">
              ${this._colOptions(schema?.listPrice)}
            </select>
          </div>
          <div class="config-field">
            <label class="config-label">Invoice / net price <span class="required">*</span></label>
            <select class="config-select" id="m1-invoice-col" onchange="Module_m1._onConfigChange()">
              ${this._colOptions(schema?.invoicePrice)}
            </select>
          </div>
          <div class="config-field">
            <label class="config-label">Segment / breakdown by</label>
            <select class="config-select" id="m1-segment-col" onchange="Module_m1._onConfigChange()">
              <option value="">— none —</option>
              ${this._catColOptions(schema?.salesRep)}
            </select>
          </div>
          <div class="config-field">
            <label class="config-label">Pocket price floor</label>
            <input class="config-input" type="number" id="m1-floor" placeholder="e.g. 18.00" min="0" step="0.01" onchange="Module_m1._onConfigChange()">
            <div class="config-hint">Accounts below this are flagged in red</div>
          </div>
        </div>

        <!-- Waterfall layers -->
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-2)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div class="config-panel-title">Discount / concession layers</div>
            <button class="export-btn" onclick="Module_m1._addLayer()" style="height:24px;font-size:10px">+ add layer</button>
          </div>
          <div id="m1-layers-list">
            ${this._renderLayersList(layers)}
          </div>
        </div>

        <div class="config-run-row">
          <button class="btn-run" id="m1-run-btn" onclick="Module_m1.run()">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polygon points="3,1 11,6 3,11" fill="currentColor"/></svg>
            Run analysis
          </button>
          <span class="run-hint" id="m1-run-hint">${layers.length > 0 ? layers.length + ' discount layers detected from schema' : 'No discount layers mapped — add layers above'}</span>
        </div>
      </div>

      <!-- Quality banner slot -->
      <div id="m1-quality-slot"></div>

      <!-- Stat cards -->
      <div class="stat-row" id="m1-stats" style="display:none">
        <div class="stat-card">
          <div class="stat-label">Avg list price</div>
          <div class="stat-value" id="m1-stat-list" style="color:var(--purple)">—</div>
          <div class="stat-sub">per transaction</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg pocket price</div>
          <div class="stat-value" id="m1-stat-pocket" style="color:var(--teal)">—</div>
          <div class="stat-sub">after all discounts</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total leakage</div>
          <div class="stat-value" id="m1-stat-leakage-pct" style="color:var(--red)">—</div>
          <div class="stat-sub" id="m1-stat-leakage-abs">of list price</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Transactions analysed</div>
          <div class="stat-value" id="m1-stat-n" style="color:var(--tx-1)">—</div>
          <div class="stat-sub" id="m1-stat-floor-note">rows</div>
        </div>
      </div>

      <!-- Charts row -->
      <div class="output-grid" id="m1-charts" style="display:none">
        <div class="output-card">
          <div class="output-card-header">
            <div class="output-card-title">Price waterfall — avg per transaction</div>
            <button class="output-card-export" onclick="Module_m1.export('chart-png')">↓ PNG</button>
          </div>
          <div class="output-card-body" style="padding:12px 16px 16px">
            <canvas id="m1-waterfall-chart" height="220"></canvas>
          </div>
        </div>
        <div class="output-card" id="m1-segment-card">
          <div class="output-card-header">
            <div class="output-card-title" id="m1-seg-card-title">Pocket price — by segment</div>
            <button class="output-card-export" onclick="Module_m1.export('seg-png')">↓ PNG</button>
          </div>
          <div class="output-card-body" style="padding:12px 16px 16px">
            <canvas id="m1-segment-chart" height="220"></canvas>
          </div>
        </div>
      </div>

      <!-- Leakage table -->
      <div class="output-card" id="m1-table-card" style="display:none;margin-bottom:20px">
        <div class="output-card-header">
          <div class="output-card-title">Account-level leakage</div>
          <div style="display:flex;align-items:center;gap:8px">
            <input class="config-input" type="text" id="m1-filter" placeholder="Filter accounts…"
              style="width:160px;height:26px;font-size:11px"
              oninput="Module_m1._onFilter(this.value)">
            <button class="output-card-export" onclick="Module_m1.export('table-csv')">↓ CSV</button>
          </div>
        </div>
        <div class="output-card-body" style="padding:0">
          <div class="data-table-wrap" style="border:none;border-radius:0">
            <table class="data-table" id="m1-table">
              <thead id="m1-thead"></thead>
              <tbody id="m1-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Drill-down panel (hidden initially) -->
      <div class="output-card" id="m1-drill" style="display:none;margin-bottom:20px">
        <div class="output-card-header">
          <div class="output-card-title" id="m1-drill-title">Account drill-down</div>
          <button class="output-card-export" onclick="Module_m1._closeDrill()">✕ close</button>
        </div>
        <div class="output-card-body" id="m1-drill-body"></div>
      </div>

      <!-- Export bar -->
      <div class="export-bar" id="m1-export-bar" style="display:none">
        <span class="export-label">Export</span>
        <button class="export-btn" onclick="Module_m1.export('chart-png')">Waterfall chart PNG</button>
        <button class="export-btn" onclick="Module_m1.export('table-csv')">Leakage table CSV</button>
        <button class="export-btn add-to-session" onclick="Module_m1.export('session')">+ Add to session export</button>
      </div>
    `;

    // Auto-run if schema is already mapped and we have data
    if (AppState.dataset && schema?.listPrice && schema?.invoicePrice) {
      setTimeout(() => this.run(), 100);
    }
  },

  // ── run ───────────────────────────────────────────────────────────────────
  run() {
    const listCol    = document.getElementById('m1-list-col')?.value || AppState.schema?.listPrice;
    const invoiceCol = document.getElementById('m1-invoice-col')?.value || AppState.schema?.invoicePrice;
    const segmentCol = document.getElementById('m1-segment-col')?.value || '';
    const floorPrice = parseFloat(document.getElementById('m1-floor')?.value) || 0;

    if (!listCol || !invoiceCol) {
      Toast.warning('List price and invoice price columns are required');
      return;
    }

    if (!AppState.dataset) {
      Toast.warning('Load a dataset first');
      return;
    }

    // Build layers from the layers list UI
    const layers = this._getLayers(listCol, invoiceCol);

    // Run computation
    const results = WaterfallEngine.compute(
      AppState.dataset.rows,
      { ...AppState.schema, listPrice: listCol, invoicePrice: invoiceCol },
      layers,
      floorPrice
    );

    if (!results) {
      Toast.error('Could not compute waterfall — check your column selections');
      return;
    }

    // Compute segments if requested
    if (segmentCol) {
      results.segments = WaterfallEngine.computeSegments(results, segmentCol);
      this._segmentBy = segmentCol;
    } else {
      results.segments = {};
      this._segmentBy = '';
    }

    this._results = results;
    AppState.setResult('m1', results);

    // Render quality banner
    const qualitySlot = document.getElementById('m1-quality-slot');
    if (qualitySlot && AppState.quality) {
      qualitySlot.innerHTML = '';
      UI.renderQualityBanner(qualitySlot, AppState.quality);
    }

    this.render(results);
    Toast.success('Waterfall analysis complete — ' + results.summary.n.toLocaleString() + ' transactions');
  },

  // ── render ────────────────────────────────────────────────────────────────
  render(results) {
    const s = results.summary;

    // Show all output sections
    document.getElementById('m1-stats').style.display        = '';
    document.getElementById('m1-charts').style.display       = '';
    document.getElementById('m1-table-card').style.display   = '';
    document.getElementById('m1-export-bar').style.display   = '';

    // ── Stat cards ──
    document.getElementById('m1-stat-list').textContent    = UI.fmtCurrency(s.avgList);
    document.getElementById('m1-stat-pocket').textContent  = UI.fmtCurrency(s.avgPocket);
    document.getElementById('m1-stat-leakage-pct').textContent = UI.fmtPct(s.avgLeakagePct);
    document.getElementById('m1-stat-leakage-abs').textContent = UI.fmtCurrency(s.totalLeakage) + ' total leakage';
    document.getElementById('m1-stat-n').textContent       = UI.fmtNum(s.n);

    if (s.belowFloorCount > 0) {
      document.getElementById('m1-stat-floor-note').textContent =
        s.belowFloorCount.toLocaleString() + ' below floor';
      document.getElementById('m1-stat-floor-note').style.color = 'var(--red)';
    }

    // ── Waterfall chart ──
    this._renderWaterfallChart(results);

    // ── Segment chart ──
    this._renderSegmentChart(results);

    // ── Table ──
    this._renderTable(results);
  },

  // ── Waterfall chart ───────────────────────────────────────────────────────
  _renderWaterfallChart(results) {
    if (this._chart) { this._chart.destroy(); this._chart = null; }

    const s      = results.summary;
    const layers = results.layerBreakdown;

    // Build waterfall: list price bar + deduction bars + pocket price bar
    const labels = ['List price', ...layers.map(l => l.name), 'Pocket price'];
    const listVal   = s.avgList;
    const pocketVal = s.avgPocket;

    // For a waterfall: each layer is a floating bar [base, base+deduction]
    // We use stacked bar with a transparent "base" segment
    const bases      = [0];
    const deductions = [listVal];
    let running = listVal;
    layers.forEach(l => {
      bases.push(running - l.avg);
      deductions.push(l.avg);
      running -= l.avg;
    });
    bases.push(0);
    deductions.push(pocketVal);

    const colours = [
      'rgba(123,116,232,0.85)',                     // list — purple
      ...layers.map(() => 'rgba(224,92,92,0.75)'),  // layers — red
      'rgba(46,196,160,0.85)'                        // pocket — teal
    ];

    const ctx = document.getElementById('m1-waterfall-chart').getContext('2d');
    this._chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Base (invisible)',
            data: bases,
            backgroundColor: 'transparent',
            borderWidth: 0,
            stack: 'waterfall'
          },
          {
            label: 'Value',
            data: deductions,
            backgroundColor: colours,
            borderWidth: 0,
            borderRadius: 3,
            stack: 'waterfall'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => {
                if (item.datasetIndex === 0) return null;
                const val = item.raw;
                const label = item.label;
                if (label === 'List price') return 'List price: ' + UI.fmtCurrency(val);
                if (label === 'Pocket price') return 'Pocket price: ' + UI.fmtCurrency(val);
                return 'Avg deduction: ' + UI.fmtCurrency(val) + ' (' + UI.fmtPct(val / s.avgList) + ' of list)';
              },
              filter: (item) => item.datasetIndex !== 0
            },
            backgroundColor: '#1E1E22',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#F0EFEC',
            bodyColor: '#A8A7A2',
            padding: 10,
            cornerRadius: 6
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: '#65635E', font: { size: 10, family: "'JetBrains Mono', monospace" } }
          },
          y: {
            stacked: true,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#65635E',
              font: { size: 10 },
              callback: (v) => '$' + v.toFixed(0)
            }
          }
        }
      }
    });
  },

  // ── Segment chart ─────────────────────────────────────────────────────────
  _renderSegmentChart(results) {
    if (this._segChart) { this._segChart.destroy(); this._segChart = null; }

    const segCard = document.getElementById('m1-segment-card');

    if (!this._segmentBy || Object.keys(results.segments).length === 0) {
      // Show pocket price distribution histogram instead
      document.getElementById('m1-seg-card-title').textContent = 'Pocket price distribution';
      this._renderHistogram(results);
      return;
    }

    document.getElementById('m1-seg-card-title').textContent = 'Leakage % by ' + this._segmentBy;

    const segs    = Object.entries(results.segments).sort((a, b) => b[1].leakagePct - a[1].leakagePct);
    const labels  = segs.map(([k]) => k);
    const values  = segs.map(([, v]) => (v.leakagePct * 100));

    const ctx = document.getElementById('m1-segment-chart').getContext('2d');
    this._segChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Leakage %',
          data: values,
          backgroundColor: values.map(v => v > 20 ? 'rgba(224,92,92,0.75)' : v > 15 ? 'rgba(224,154,60,0.75)' : 'rgba(46,196,160,0.65)'),
          borderWidth: 0,
          borderRadius: 3
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => 'Leakage: ' + item.raw.toFixed(1) + '%'
            },
            backgroundColor: '#1E1E22',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#F0EFEC',
            bodyColor: '#A8A7A2',
            padding: 10,
            cornerRadius: 6
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#65635E', font: { size: 10 }, callback: v => v + '%' }
          },
          y: {
            grid: { display: false },
            ticks: { color: '#A8A7A2', font: { size: 10 } }
          }
        }
      }
    });
  },

  _renderHistogram(results) {
    const pocketPrices = results.rows.map(r => r._pocketPrice);
    const min  = Math.min(...pocketPrices);
    const max  = Math.max(...pocketPrices);
    const bins = 20;
    const w    = (max - min) / bins;
    const counts = Array(bins).fill(0);
    pocketPrices.forEach(p => {
      const i = Math.min(Math.floor((p - min) / w), bins - 1);
      counts[i]++;
    });
    const labels = counts.map((_, i) => '$' + (min + i * w).toFixed(0));

    const ctx = document.getElementById('m1-segment-chart').getContext('2d');
    this._segChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Transactions',
          data: counts,
          backgroundColor: 'rgba(123,116,232,0.6)',
          borderWidth: 0,
          borderRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => 'Pocket price ≈ ' + items[0].label,
              label: (item)  => item.raw + ' transactions'
            },
            backgroundColor: '#1E1E22',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#F0EFEC',
            bodyColor: '#A8A7A2',
            padding: 10,
            cornerRadius: 6
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#65635E', font: { size: 9, family: "'JetBrains Mono', monospace" }, maxRotation: 45 }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#65635E', font: { size: 10 } }
          }
        }
      }
    });
  },

  // ── Table ─────────────────────────────────────────────────────────────────
  _renderTable(results) {
    const schema  = AppState.schema;
    const idCol   = 'transaction_id';
    const custCol = schema?.customerTier ? 'customer_id' : null;
    const layers  = results.layerBreakdown;

    // Header
    const headCols = [
      { label: 'Account / ID',    key: idCol,         cls: '' },
      { label: 'List price',      key: '_listPrice',  cls: 'td-num' },
      ...layers.slice(0, 4).map(l => ({ label: l.name, key: '_layer_' + l.column, cls: 'td-pct' })),
      { label: 'Pocket price',    key: '_pocketPrice', cls: 'td-ok' },
      { label: 'Leakage %',       key: '_leakagePct',  cls: 'td-pct' },
      { label: 'Leakage $',       key: '_leakage',     cls: 'td-num' }
    ];

    const thead = document.getElementById('m1-thead');
    thead.innerHTML = '<tr>' + headCols.map(c =>
      `<th class="${c.key === this._sortCol ? 'sorted' : ''}" onclick="Module_m1._sort('${c.key}')">${c.label} ${c.key === this._sortCol ? (this._sortDir > 0 ? '↑' : '↓') : ''}</th>`
    ).join('') + '</tr>';

    this._headCols = headCols;
    this._renderTableBody(results);
  },

  _renderTableBody(results) {
    const tbody = document.getElementById('m1-tbody');
    const idCol = 'transaction_id';

    // Filter
    let rows = results.rows;
    if (this._filterText) {
      const ft = this._filterText.toLowerCase();
      rows = rows.filter(r => {
        const id = String(r[idCol] || r.customer_id || '').toLowerCase();
        return id.includes(ft);
      });
    }

    // Sort
    const col = this._sortCol;
    rows = [...rows].sort((a, b) => {
      let av = col.startsWith('_layer_') ? (a._steps?.find(s => s.label === col.replace('_layer_',''))?.deduction || 0) : a[col];
      let bv = col.startsWith('_layer_') ? (b._steps?.find(s => s.label === col.replace('_layer_',''))?.deduction || 0) : b[col];
      return (av - bv) * this._sortDir;
    });

    // Render — show top 200
    const display = rows.slice(0, 200);
    tbody.innerHTML = display.map((r, i) => {
      const belowFloor = r._belowFloor;
      return `<tr onclick="Module_m1._drillDown(${results.rows.indexOf(r)})" style="${belowFloor ? 'background:rgba(224,92,92,0.04)' : ''}">
        <td style="color:${belowFloor ? 'var(--red)' : 'var(--tx-1)'}">
          ${r[idCol] || r.customer_id || '#' + (i+1)}
          ${belowFloor ? '<span style="color:var(--red);font-size:9px;margin-left:4px">▼ below floor</span>' : ''}
        </td>
        <td class="td-num">${UI.fmtCurrency(r._listPrice)}</td>
        ${results.layerBreakdown.slice(0,4).map(l => {
          const step = r._steps?.find(s => s.label === l.name);
          return `<td class="td-pct">${step ? UI.fmtPct(step.value || 0) : '—'}</td>`;
        }).join('')}
        <td class="td-ok">${UI.fmtCurrency(r._pocketPrice)}</td>
        <td class="td-pct" style="color:${r._leakagePct > 0.25 ? 'var(--red)' : r._leakagePct > 0.15 ? 'var(--amber)' : 'var(--teal)'}">${UI.fmtPct(r._leakagePct)}</td>
        <td class="td-num" style="color:var(--red)">${UI.fmtCurrency(r._leakage)}</td>
      </tr>`;
    }).join('');

    if (rows.length > 200) {
      tbody.innerHTML += `<tr><td colspan="10" style="text-align:center;color:var(--tx-3);font-size:11px;padding:10px">
        Showing 200 of ${rows.length.toLocaleString()} rows — export CSV for full dataset
      </td></tr>`;
    }
  },

  // ── Drill-down ────────────────────────────────────────────────────────────
  _drillDown(idx) {
    const r = this._results?.rows[idx];
    if (!r) return;

    const drillEl = document.getElementById('m1-drill');
    const idKey   = 'transaction_id';
    const id      = r[idKey] || r.customer_id || 'Row ' + (idx + 1);

    document.getElementById('m1-drill-title').textContent = 'Waterfall drill-down — ' + id;

    const steps = r._steps || [];
    const bars  = steps.map(s => {
      const pct = s.value > 0 ? ((s.deduction || s.value) / r._listPrice * 100).toFixed(1) : '—';
      const isDeduction = steps.indexOf(s) > 0 && steps.indexOf(s) < steps.length - 1;
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-2)">
          <div style="flex:0 0 140px;font-size:12px;color:var(--tx-2)">${s.label}</div>
          <div style="flex:1;background:var(--bg-app);border-radius:3px;height:8px;overflow:hidden">
            <div style="height:100%;border-radius:3px;width:${Math.min((s.running || s.value) / r._listPrice * 100, 100)}%;
              background:${isDeduction ? 'rgba(224,92,92,0.6)' : steps.indexOf(s) === 0 ? 'rgba(123,116,232,0.6)' : 'rgba(46,196,160,0.6)'}">
            </div>
          </div>
          <div style="flex:0 0 80px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:11px;
            color:${isDeduction ? 'var(--red)' : steps.indexOf(s) === steps.length-1 ? 'var(--teal)' : 'var(--purple)'}">
            ${isDeduction ? '−' + UI.fmtCurrency(s.deduction) : UI.fmtCurrency(s.running || s.value)}
          </div>
          <div style="flex:0 0 50px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx-3)">
            ${isDeduction ? pct + '%' : ''}
          </div>
        </div>`;
    }).join('');

    document.getElementById('m1-drill-body').innerHTML = `
      <div style="margin-bottom:12px;font-size:12px;color:var(--tx-3)">
        Total leakage: <strong style="color:var(--red)">${UI.fmtCurrency(r._leakage)}</strong>
        (${UI.fmtPct(r._leakagePct)} of list)
        ${r._belowFloor ? `<span style="color:var(--red);margin-left:10px">▼ Below floor price</span>` : ''}
      </div>
      ${bars}
    `;

    drillEl.style.display = '';
    drillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  _closeDrill() {
    document.getElementById('m1-drill').style.display = 'none';
  },

  // ── Export ────────────────────────────────────────────────────────────────
  export(format) {
    if (!this._results) { Toast.warning('Run the analysis first'); return; }

    if (format === 'chart-png') {
      const canvas = document.getElementById('m1-waterfall-chart');
      const link   = document.createElement('a');
      link.download = 'waterfall-chart.png';
      link.href     = canvas.toDataURL('image/png');
      link.click();
      Toast.success('Waterfall chart exported');
    }

    if (format === 'seg-png') {
      const canvas = document.getElementById('m1-segment-chart');
      const link   = document.createElement('a');
      link.download = 'segment-chart.png';
      link.href     = canvas.toDataURL('image/png');
      link.click();
      Toast.success('Segment chart exported');
    }

    if (format === 'table-csv') {
      const schema = AppState.schema;
      const idCol  = 'transaction_id';
      const rows   = this._results.rows;
      const layers = this._results.layerBreakdown;

      const headers = [idCol, 'list_price', ...layers.map(l => l.column + '_discount'), 'pocket_price', 'leakage_pct', 'leakage_abs'];
      const csvRows = [headers.join(',')];
      rows.forEach(r => {
        const layerVals = layers.map(l => {
          const step = r._steps?.find(s => s.label === l.name);
          return step ? (step.value || 0).toFixed(4) : '0';
        });
        csvRows.push([
          r[idCol] || '',
          r._listPrice.toFixed(2),
          ...layerVals,
          r._pocketPrice.toFixed(2),
          (r._leakagePct * 100).toFixed(2) + '%',
          r._leakage.toFixed(2)
        ].join(','));
      });

      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'price-waterfall-leakage.csv';
      link.href     = URL.createObjectURL(blob);
      link.click();
      Toast.success('Leakage table exported — ' + rows.length.toLocaleString() + ' rows');
    }

    if (format === 'session') {
      AppState.setResult('m1', this._results);
      Toast.success('Added to session export');
    }
  },

  // ── UI helpers ────────────────────────────────────────────────────────────
  _colOptions(selected) {
    const cols = AppState.dataset?.columns || [];
    return '<option value="">— select column —</option>' +
      cols.map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
  },

  _catColOptions(selected) {
    const cols = AppState.dataset?.columns || [];
    return cols.map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
  },

  _renderLayersList(layers) {
    if (!layers || layers.length === 0) {
      return `<div style="font-size:11px;color:var(--tx-3);padding:8px 0">
        No discount layers detected. Add layers manually or ensure your dataset has percentage columns.
      </div>`;
    }
    return layers.map((l, i) => `
      <div class="m1-layer-row" data-idx="${i}" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="width:16px;height:16px;border-radius:3px;background:var(--bg-card-2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--tx-3);cursor:grab">⠿</div>
        <input class="config-input" style="flex:1;height:28px;font-size:11px" value="${l.name}" oninput="Module_m1._updateLayerName(${i}, this.value)">
        <select class="config-select" style="flex:1;height:28px;font-size:11px;font-family:var(--font-mono)" onchange="Module_m1._updateLayerCol(${i}, this.value)">
          ${(AppState.dataset?.columns || []).map(c => `<option value="${c}" ${c === l.column ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <select class="config-select" style="width:90px;height:28px;font-size:11px" onchange="Module_m1._updateLayerType(${i}, this.value)">
          <option value="percent" ${l.type === 'percent' ? 'selected' : ''}>% of list</option>
          <option value="absolute" ${l.type === 'absolute' ? 'selected' : ''}>absolute $</option>
        </select>
        <button onclick="Module_m1._removeLayer(${i})" style="width:22px;height:22px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);font-size:11px;cursor:pointer;flex-shrink:0">✕</button>
      </div>`).join('');
  },

  _getLayers(listCol, invoiceCol) {
    // Read current layers from UI state
    if (AppState.schema?.discountLayers?.length > 0) {
      return AppState.schema.discountLayers;
    }
    // Fallback: derive from the difference between list and invoice
    return [];
  },

  _addLayer() {
    const cols = AppState.dataset?.columns || [];
    if (!AppState.schema) AppState.schema = {};
    if (!AppState.schema.discountLayers) AppState.schema.discountLayers = [];
    AppState.schema.discountLayers.push({ name: 'New layer', column: cols[0] || '', type: 'percent' });
    document.getElementById('m1-layers-list').innerHTML = this._renderLayersList(AppState.schema.discountLayers);
  },

  _removeLayer(i) {
    AppState.schema.discountLayers.splice(i, 1);
    document.getElementById('m1-layers-list').innerHTML = this._renderLayersList(AppState.schema.discountLayers);
  },

  _updateLayerName(i, val) { if (AppState.schema?.discountLayers?.[i]) AppState.schema.discountLayers[i].name = val; },
  _updateLayerCol(i, val)  { if (AppState.schema?.discountLayers?.[i]) AppState.schema.discountLayers[i].column = val; },
  _updateLayerType(i, val) { if (AppState.schema?.discountLayers?.[i]) AppState.schema.discountLayers[i].type = val; },

  _toggleFC() {
    const text   = document.getElementById('m1-fc-text');
    const toggle = document.getElementById('m1-fc-toggle');
    const hidden = text.style.display === 'none';
    text.style.display   = hidden ? '' : 'none';
    toggle.textContent   = hidden ? '▲' : '▼';
  },

  _toggleConfig() {
    const panel = document.getElementById('m1-config');
    const rows  = panel.querySelectorAll('.config-row, .m1-layer-row, #m1-layers-list, .config-run-row');
    const isCollapsed = panel.dataset.collapsed === '1';
    rows.forEach(r => r.style.display = isCollapsed ? '' : 'none');
    panel.dataset.collapsed = isCollapsed ? '0' : '1';
    panel.querySelector('.config-collapse-btn').textContent = isCollapsed ? 'collapse ▲' : 'expand ▼';
  },

  _onConfigChange() {
    // Re-run hint
    const hint = document.getElementById('m1-run-hint');
    if (hint) hint.textContent = 'Configuration changed — click Run analysis';
  },

  _sort(col) {
    if (this._sortCol === col) this._sortDir *= -1;
    else { this._sortCol = col; this._sortDir = -1; }
    if (this._results) {
      this._renderTable(this._results);
    }
  },

  _onFilter(val) {
    this._filterText = val;
    if (this._results) this._renderTableBody(this._results);
  }
};
