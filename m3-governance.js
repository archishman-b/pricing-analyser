/**
 * M3 — Discount Governance Dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts pricing policy rules into a live compliance monitor. Scores every
 * transaction against approved discount ceilings and surfaces violations
 * by rep, region, and product.
 */

'use strict';

const GovernanceEngine = {

  /**
   * Evaluate all transactions against policy rules.
   * rules: [{ dimension, value, maxDiscount, requiresApproval }]
   */
  evaluate(rows, schema, rules, defaultMax) {
    if (!rows || rows.length === 0) return { error: 'No data' };

    const results = rows.map(row => {
      const list    = parseFloat(row[schema.listPrice]);
      const invoice = parseFloat(row[schema.invoicePrice]);
      if (!list || !invoice || list <= 0) return null;

      const discPct = (list - invoice) / list;

      // Find the most specific rule that applies to this row
      let applicableRule = null;
      let maxDiscount    = defaultMax;

      rules.forEach(rule => {
        if (!rule.dimension || !rule.value) return;
        const rowVal = String(row[rule.dimension] || '').toLowerCase();
        const ruleVal = String(rule.value).toLowerCase();
        if (rowVal === ruleVal || rowVal.includes(ruleVal)) {
          // More specific rule wins
          applicableRule = rule;
          maxDiscount    = rule.maxDiscount;
        }
      });

      const isViolation = discPct > maxDiscount;
      const excess      = isViolation ? (discPct - maxDiscount) * list : 0;
      const severity    = !isViolation ? 'ok'
        : discPct > maxDiscount * 1.5 ? 'critical'
        : discPct > maxDiscount * 1.2 ? 'high'
        : 'medium';

      return {
        ...row,
        _discPct:      discPct,
        _list:         list,
        _invoice:      invoice,
        _maxDiscount:  maxDiscount,
        _rule:         applicableRule,
        _isViolation:  isViolation,
        _excess:       excess,
        _severity:     severity
      };
    }).filter(Boolean);

    // Summary
    const n           = results.length;
    const violations  = results.filter(r => r._isViolation);
    const complianceRate = (n - violations.length) / n;
    const totalExcess = violations.reduce((s, r) => s + r._excess, 0);

    // Heatmap: rep × product (or rep × region)
    const heatmap = this._buildHeatmap(results, schema);

    // Trend (if date column)
    const trend = schema.date ? this._buildTrend(results, schema) : [];

    // Severity breakdown
    const bySeverity = {
      critical: violations.filter(r => r._severity === 'critical').length,
      high:     violations.filter(r => r._severity === 'high').length,
      medium:   violations.filter(r => r._severity === 'medium').length
    };

    return { rows: results, violations, n, complianceRate, totalExcess, heatmap, trend, bySeverity, error: null };
  },

  _buildHeatmap(results, schema) {
    const rowDim = schema.salesRep;
    const colDim = schema.product || schema.region || schema.customerTier;
    if (!rowDim || !colDim) return null;

    const rows  = [...new Set(results.map(r => r[rowDim]))].sort();
    const cols  = [...new Set(results.map(r => r[colDim]))].sort();
    const cells = {};

    results.forEach(r => {
      const key = r[rowDim] + '||' + r[colDim];
      if (!cells[key]) cells[key] = { total: 0, violations: 0 };
      cells[key].total++;
      if (r._isViolation) cells[key].violations++;
    });

    return {
      rows, cols,
      getRate: (row, col) => {
        const c = cells[row + '||' + col];
        return c ? c.violations / c.total : 0;
      },
      getCount: (row, col) => {
        const c = cells[row + '||' + col];
        return c ? c.violations : 0;
      }
    };
  },

  _buildTrend(results, schema) {
    // Group by month
    const byMonth = {};
    results.forEach(r => {
      const d = r[schema.date];
      if (!d) return;
      const key = String(d).substring(0, 7); // YYYY-MM
      if (!byMonth[key]) byMonth[key] = { total: 0, violations: 0 };
      byMonth[key].total++;
      if (r._isViolation) byMonth[key].violations++;
    });

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month,
        complianceRate: (d.total - d.violations) / d.total,
        violations: d.violations,
        total: d.total
      }));
  }
};


window.Module_m3 = {

  _trendChart:    null,
  _results:       null,
  _rules:         [],
  _defaultMax:    0.20,

  init() {
    const pane   = document.getElementById('pane-m3');
    const schema = AppState.schema || {};
    const cols   = AppState.dataset?.columns || [];

    // Initialise default rules from schema
    this._rules = [];
    if (schema.customerTier) {
      this._rules = [
        { dimension: schema.customerTier, value: 'Gold',     maxDiscount: 0.15, requiresApproval: false },
        { dimension: schema.customerTier, value: 'Silver',   maxDiscount: 0.18, requiresApproval: false },
        { dimension: schema.customerTier, value: 'Bronze',   maxDiscount: 0.22, requiresApproval: true  },
        { dimension: schema.customerTier, value: 'Standard', maxDiscount: 0.25, requiresApproval: true  }
      ];
    }

    const catCols = cols.filter(c =>
      c !== schema.listPrice && c !== schema.invoicePrice &&
      c !== schema.variableCost && c !== schema.quantity &&
      c !== 'transaction_id' && c !== 'date');

    pane.innerHTML = `
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-eyebrow">Diagnostic · Module 3</div>
          <div class="module-title">Discount governance</div>
          <div class="module-desc">Converts pricing policy rules into a live compliance monitor. Scores every transaction against approved discount ceilings and surfaces violations by rep, region, and product.</div>
        </div>
        <div class="module-header-right">
          <span class="tag tag-phase-2">Phase 2</span>
        </div>
      </div>

      <div class="framework-callout" onclick="Module_m3._toggleFC()">
        <div class="fc-icon">◎</div>
        <div class="fc-body">
          <div class="fc-label">Framework — discount governance</div>
          <div class="fc-text" id="m3-fc-text">Pricing policy without monitoring is not policy — it is aspiration. This module converts stated discount ceilings into a transaction-level compliance score, surfaces the reps and segments driving the most leakage, and quantifies the cost of non-compliance. The governance dashboard is the weekly operating tool for a pricing manager; the compliance trend is what goes to the CFO.</div>
        </div>
        <div class="fc-expand">▲</div>
      </div>

      <!-- Policy rule builder -->
      <div class="config-panel">
        <div class="config-panel-header">
          <div class="config-panel-title">Policy rules</div>
          <button class="export-btn" onclick="Module_m3._addRule()" style="height:24px;font-size:10px">+ add rule</button>
        </div>

        <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px">
          <div class="config-field" style="flex:0 0 180px">
            <label class="config-label">Default max discount</label>
            <input class="config-input" type="number" id="m3-default-max" value="${(this._defaultMax*100).toFixed(0)}"
              min="0" max="100" step="1" style="height:30px"
              oninput="Module_m3._defaultMax = parseFloat(this.value)/100">
          </div>
          <div style="font-size:11px;color:var(--tx-3);margin-top:14px">Applied when no specific rule matches</div>
        </div>

        <div id="m3-rules-list">
          ${this._renderRulesList()}
        </div>

        <div style="margin-top:8px;font-size:11px;color:var(--tx-3)">
          Dimension column:
          <select class="config-select" id="m3-dim-col" style="width:160px;height:26px;font-size:11px;margin-left:6px">
            ${catCols.map(c => `<option value="${c}" ${c === schema.customerTier ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>

        <div class="config-run-row">
          <button class="btn-run" onclick="Module_m3.run()">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polygon points="3,1 11,6 3,11" fill="currentColor"/></svg>
            Run governance check
          </button>
          <span class="run-hint">${this._rules.length} rules configured · default max ${(this._defaultMax*100).toFixed(0)}%</span>
        </div>
      </div>

      <!-- Compliance hero -->
      <div id="m3-compliance-hero" style="display:none;margin-bottom:20px">
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px">
          <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:16px">
            <div>
              <div style="font-size:10px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.07em;color:var(--tx-3);margin-bottom:6px">Compliance rate</div>
              <div class="stat-value" id="m3-compliance-pct" style="font-size:42px">—</div>
            </div>
            <div style="width:1px;height:56px;background:var(--border);flex-shrink:0"></div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;flex:1;min-width:280px">
              <div>
                <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Violations</div>
                <div style="font-size:18px;font-weight:600;font-family:'Syne',sans-serif;color:var(--red)" id="m3-violation-count">—</div>
              </div>
              <div>
                <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Excess discount $</div>
                <div style="font-size:18px;font-weight:600;font-family:'Syne',sans-serif;color:var(--amber)" id="m3-excess-total">—</div>
              </div>
              <div>
                <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Critical breaches</div>
                <div style="font-size:18px;font-weight:600;font-family:'Syne',sans-serif;color:var(--red)" id="m3-critical-count">—</div>
              </div>
            </div>
          </div>
          <!-- Severity bar -->
          <div style="display:flex;gap:6px;align-items:center">
            <div style="font-size:10px;color:var(--tx-3);width:70px;flex-shrink:0">Severity</div>
            <div style="flex:1;display:flex;height:8px;border-radius:4px;overflow:hidden">
              <div id="m3-bar-ok"       style="background:rgba(46,196,160,0.7);transition:width .4s"></div>
              <div id="m3-bar-medium"   style="background:rgba(224,154,60,0.7);transition:width .4s"></div>
              <div id="m3-bar-high"     style="background:rgba(224,92,92,0.6);transition:width .4s"></div>
              <div id="m3-bar-critical" style="background:rgba(163,45,45,0.9);transition:width .4s"></div>
            </div>
            <div id="m3-severity-legend" style="font-size:10px;color:var(--tx-3);font-family:'JetBrains Mono',monospace"></div>
          </div>
        </div>
      </div>

      <!-- Heatmap + trend row -->
      <div class="output-grid" id="m3-charts" style="display:none">
        <div class="output-card">
          <div class="output-card-header">
            <div class="output-card-title" id="m3-heatmap-title">Violation rate — rep × product</div>
          </div>
          <div class="output-card-body" id="m3-heatmap-body" style="padding:12px;overflow-x:auto">
          </div>
        </div>
        <div class="output-card">
          <div class="output-card-header">
            <div class="output-card-title">Compliance trend</div>
            <button class="output-card-export" onclick="Module_m3.export('trend-png')">↓ PNG</button>
          </div>
          <div class="output-card-body" style="padding:12px 16px 16px">
            <canvas id="m3-trend-chart" height="200"></canvas>
          </div>
        </div>
      </div>

      <!-- Violation list -->
      <div class="output-card" id="m3-violations-card" style="display:none;margin:14px 0">
        <div class="output-card-header">
          <div class="output-card-title" id="m3-violations-title">Escalation flag list</div>
          <div style="display:flex;gap:4px">
            <button onclick="Module_m3._filterViolations('all')"      id="m3-f-all"      style="font-size:10px;padding:3px 8px;border-radius:3px;border:1px solid var(--accent);background:var(--accent-lt);color:var(--accent);cursor:pointer;font-family:inherit">All</button>
            <button onclick="Module_m3._filterViolations('critical')" id="m3-f-critical" style="font-size:10px;padding:3px 8px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);cursor:pointer;font-family:inherit">Critical</button>
            <button onclick="Module_m3._filterViolations('high')"     id="m3-f-high"     style="font-size:10px;padding:3px 8px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);cursor:pointer;font-family:inherit">High</button>
            <button class="output-card-export" onclick="Module_m3.export('violations-csv')">↓ CSV</button>
          </div>
        </div>
        <div class="output-card-body" style="padding:0">
          <div class="data-table-wrap" style="border:none;border-radius:0">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  ${AppState.schema?.salesRep   ? '<th>Rep</th>'     : ''}
                  ${AppState.schema?.region     ? '<th>Region</th>'  : ''}
                  <th>Discount %</th>
                  <th>Policy max</th>
                  <th>Excess $</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody id="m3-violations-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Export bar -->
      <div class="export-bar" id="m3-export-bar" style="display:none">
        <span class="export-label">Export</span>
        <button class="export-btn" onclick="Module_m3.export('violations-csv')">Violations CSV</button>
        <button class="export-btn" onclick="Module_m3.export('summary-csv')">Summary CSV</button>
        <button class="export-btn add-to-session" onclick="Module_m3.export('session')">+ Add to session export</button>
      </div>
    `;
  },

  run() {
    if (!AppState.dataset || !AppState.schema) {
      Toast.warning('Load and map a dataset first');
      return;
    }

    // Update rules dimension from selector
    const dimCol = document.getElementById('m3-dim-col')?.value;
    const defaultMax = parseFloat(document.getElementById('m3-default-max')?.value || 20) / 100;
    this._defaultMax = defaultMax;

    // Re-read rules from UI
    const updatedRules = this._getRulesFromUI(dimCol);

    const results = GovernanceEngine.evaluate(
      AppState.dataset.rows,
      AppState.schema,
      updatedRules,
      defaultMax
    );

    if (results.error) { Toast.error(results.error); return; }

    this._results = results;
    AppState.setResult('m3', results);
    this.render(results);

    const compPct = (results.complianceRate * 100).toFixed(1);
    Toast.success('Governance check complete — ' + compPct + '% compliant');
  },

  render(results) {
    const { complianceRate, violations, totalExcess, bySeverity, n } = results;

    // Hero
    document.getElementById('m3-compliance-hero').style.display = '';
    const compEl = document.getElementById('m3-compliance-pct');
    compEl.textContent = (complianceRate * 100).toFixed(1) + '%';
    compEl.style.color = complianceRate >= 0.90 ? 'var(--teal)' : complianceRate >= 0.75 ? 'var(--amber)' : 'var(--red)';

    document.getElementById('m3-violation-count').textContent = UI.fmtNum(violations.length) + ' of ' + UI.fmtNum(n);
    document.getElementById('m3-excess-total').textContent    = UI.fmtCurrency(totalExcess);
    document.getElementById('m3-critical-count').textContent  = UI.fmtNum(bySeverity.critical);

    // Severity bar
    const okCount  = n - violations.length;
    document.getElementById('m3-bar-ok').style.width       = (okCount / n * 100) + '%';
    document.getElementById('m3-bar-medium').style.width   = (bySeverity.medium / n * 100) + '%';
    document.getElementById('m3-bar-high').style.width     = (bySeverity.high / n * 100) + '%';
    document.getElementById('m3-bar-critical').style.width = (bySeverity.critical / n * 100) + '%';
    document.getElementById('m3-severity-legend').textContent =
      `ok: ${okCount} · med: ${bySeverity.medium} · high: ${bySeverity.high} · critical: ${bySeverity.critical}`;

    // Charts
    document.getElementById('m3-charts').style.display          = '';
    document.getElementById('m3-violations-card').style.display = '';
    document.getElementById('m3-export-bar').style.display      = '';

    this._renderHeatmap(results);
    this._renderTrend(results);
    this._filterViolations('all');
  },

  _renderHeatmap(results) {
    const hm   = results.heatmap;
    const body = document.getElementById('m3-heatmap-body');
    if (!hm) { body.innerHTML = '<div style="font-size:12px;color:var(--tx-3);padding:8px">No categorical dimension pair available for heatmap</div>'; return; }

    const schema = AppState.schema;
    document.getElementById('m3-heatmap-title').textContent =
      'Violation rate — ' + (schema.salesRep || 'rep') + ' × ' + (schema.product || schema.region || 'segment');

    const colourFor = (rate) => {
      if (rate === 0)      return 'rgba(46,196,160,0.15)';
      if (rate < 0.10)     return 'rgba(46,196,160,0.35)';
      if (rate < 0.20)     return 'rgba(224,154,60,0.35)';
      if (rate < 0.35)     return 'rgba(224,92,92,0.45)';
      return 'rgba(163,45,45,0.65)';
    };
    const textFor = (rate) => rate === 0 ? 'var(--tx-3)' : rate < 0.10 ? 'var(--teal)' : rate < 0.20 ? 'var(--amber)' : 'var(--red)';

    // Build table HTML
    const colHeaders = hm.cols.map(c => `<th style="font-size:9px;padding:4px 6px;color:var(--tx-3);white-space:nowrap;max-width:70px;overflow:hidden;text-overflow:ellipsis" title="${c}">${c}</th>`).join('');
    const dataRows   = hm.rows.map(row => {
      const cells = hm.cols.map(col => {
        const rate  = hm.getRate(row, col);
        const count = hm.getCount(row, col);
        return `<td style="text-align:center;padding:5px 6px;background:${colourFor(rate)};border-radius:3px;font-size:10px;font-family:'JetBrains Mono',monospace;color:${textFor(rate)}" title="${row} × ${col}: ${(rate*100).toFixed(0)}% violation rate">
          ${rate > 0 ? (rate * 100).toFixed(0) + '%' : '—'}
        </td>`;
      }).join('');
      return `<tr><td style="font-size:11px;color:var(--tx-2);padding:5px 8px;white-space:nowrap">${row}</td>${cells}</tr>`;
    }).join('');

    body.innerHTML = `
      <table style="width:100%;border-collapse:separate;border-spacing:3px">
        <thead><tr><th style="font-size:9px;padding:4px 8px;color:var(--tx-3)"></th>${colHeaders}</tr></thead>
        <tbody>${dataRows}</tbody>
      </table>
      <div style="margin-top:8px;display:flex;gap:10px;font-size:10px;color:var(--tx-3)">
        <span>Violation rate: </span>
        <span style="color:var(--teal)">■ 0%</span>
        <span style="color:rgba(46,196,160,0.8)">■ &lt;10%</span>
        <span style="color:var(--amber)">■ 10–20%</span>
        <span style="color:var(--red)">■ 20–35%</span>
        <span style="color:#A32D2D">■ &gt;35%</span>
      </div>`;
  },

  _renderTrend(results) {
    if (this._trendChart) { this._trendChart.destroy(); this._trendChart = null; }
    const trend = results.trend;

    if (!trend || trend.length === 0) {
      document.getElementById('m3-trend-chart').parentElement.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--tx-3);font-size:12px">No date column mapped — trend view unavailable</div>';
      return;
    }

    const ctx = document.getElementById('m3-trend-chart').getContext('2d');
    this._trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: trend.map(t => t.month),
        datasets: [{
          label: 'Compliance rate',
          data:  trend.map(t => t.complianceRate * 100),
          borderColor:     'rgba(200,169,110,0.9)',
          backgroundColor: 'rgba(200,169,110,0.08)',
          borderWidth:     2,
          pointRadius:     3,
          fill:            true,
          tension:         0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: item => item.raw.toFixed(1) + '% compliant · ' + trend[item.dataIndex].violations + ' violations'
            },
            backgroundColor: '#1E1E22',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#F0EFEC',
            bodyColor:  '#A8A7A2',
            padding:    10,
            cornerRadius: 6
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#65635E', font: { size: 9 } } },
          y: {
            min: 0, max: 100,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#65635E', font: { size: 10 }, callback: v => v + '%' }
          }
        }
      }
    });
  },

  _filterViolations(severity) {
    if (!this._results) return;
    this._currentSeverity = severity;

    ['all','critical','high'].forEach(s => {
      const btn = document.getElementById('m3-f-' + s);
      if (btn) {
        btn.style.background  = s === severity ? 'var(--accent-lt)' : 'transparent';
        btn.style.borderColor = s === severity ? 'var(--accent)'    : 'var(--border)';
        btn.style.color       = s === severity ? 'var(--accent)'    : 'var(--tx-3)';
      }
    });

    const schema = AppState.schema;
    let rows = this._results.violations;
    if (severity !== 'all') rows = rows.filter(r => r._severity === severity);

    document.getElementById('m3-violations-title').textContent =
      `Escalation flag list — ${rows.length} ${severity === 'all' ? 'violations' : severity + ' violations'}`;

    const sevColour = { critical: 'var(--red)', high: 'rgba(224,92,92,0.7)', medium: 'var(--amber)' };
    const sevBg     = { critical: 'var(--red-lt)', high: 'rgba(224,92,92,0.1)', medium: 'var(--amber-lt)' };

    document.getElementById('m3-violations-tbody').innerHTML = rows.slice(0, 200).map(r => `
      <tr style="${r._severity === 'critical' ? 'background:rgba(163,45,45,0.06)' : ''}">
        <td style="color:var(--tx-1)">${r.transaction_id || r.customer_id || '—'}</td>
        ${schema.salesRep ? `<td style="color:var(--tx-2)">${r[schema.salesRep] || '—'}</td>` : ''}
        ${schema.region   ? `<td style="color:var(--tx-2)">${r[schema.region] || '—'}</td>` : ''}
        <td class="td-pct" style="color:var(--red)">${UI.fmtPct(r._discPct)}</td>
        <td class="td-pct" style="color:var(--tx-3)">${UI.fmtPct(r._maxDiscount)}</td>
        <td class="td-num" style="color:var(--red)">+${UI.fmtCurrency(r._excess)}</td>
        <td><span style="font-size:10px;padding:2px 7px;border-radius:3px;font-weight:500;background:${sevBg[r._severity]||'var(--amber-lt)'};color:${sevColour[r._severity]||'var(--amber)'}">
          ${r._severity}
        </span></td>
      </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--teal);padding:20px;font-size:13px">✓ No violations in this category</td></tr>';
  },

  _renderRulesList() {
    if (this._rules.length === 0) {
      return '<div style="font-size:11px;color:var(--tx-3);padding:6px 0">No rules configured — using default max for all transactions</div>';
    }
    return this._rules.map((rule, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input class="config-input" style="flex:1;height:28px;font-size:11px" placeholder="Dimension value (e.g. Gold)" value="${rule.value}"
          oninput="Module_m3._rules[${i}].value = this.value">
        <input class="config-input" type="number" style="width:80px;height:28px;font-size:11px" placeholder="Max %" value="${(rule.maxDiscount*100).toFixed(0)}"
          oninput="Module_m3._rules[${i}].maxDiscount = parseFloat(this.value)/100" min="0" max="100" step="1">
        <label style="font-size:11px;color:var(--tx-3);display:flex;align-items:center;gap:4px;white-space:nowrap">
          <input type="checkbox" ${rule.requiresApproval ? 'checked' : ''}
            style="accent-color:var(--accent)"
            onchange="Module_m3._rules[${i}].requiresApproval = this.checked"> Needs approval
        </label>
        <button onclick="Module_m3._removeRule(${i})" style="width:22px;height:22px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);font-size:11px;cursor:pointer;flex-shrink:0">✕</button>
      </div>`).join('');
  },

  _addRule() {
    this._rules.push({ dimension: '', value: '', maxDiscount: 0.20, requiresApproval: false });
    document.getElementById('m3-rules-list').innerHTML = this._renderRulesList();
  },

  _removeRule(i) {
    this._rules.splice(i, 1);
    document.getElementById('m3-rules-list').innerHTML = this._renderRulesList();
  },

  _getRulesFromUI(dimCol) {
    return this._rules.map(r => ({ ...r, dimension: dimCol || r.dimension }));
  },

  export(format) {
    if (!this._results) { Toast.warning('Run the governance check first'); return; }

    if (format === 'violations-csv') {
      const schema = AppState.schema;
      const rows   = this._results.violations;
      const headers = ['transaction_id', schema.salesRep, schema.region, 'discount_pct', 'max_discount', 'excess_discount', 'severity'].filter(Boolean);
      const csv = [headers.join(','), ...rows.map(r => [
        r['transaction_id'] || '',
        schema.salesRep ? (r[schema.salesRep] || '') : null,
        schema.region   ? (r[schema.region] || '') : null,
        (r._discPct * 100).toFixed(2) + '%',
        (r._maxDiscount * 100).toFixed(0) + '%',
        r._excess.toFixed(2),
        r._severity
      ].filter(v => v !== null).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'discount-violations.csv';
      link.href = URL.createObjectURL(blob);
      link.click();
      Toast.success('Violations exported');
    }

    if (format === 'summary-csv') {
      const { complianceRate, violations, n, totalExcess, bySeverity } = this._results;
      const csv = [
        'metric,value',
        'compliance_rate,' + (complianceRate * 100).toFixed(1) + '%',
        'total_transactions,' + n,
        'violations,' + violations.length,
        'excess_discount_total,' + totalExcess.toFixed(2),
        'critical,' + bySeverity.critical,
        'high,' + bySeverity.high,
        'medium,' + bySeverity.medium
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'governance-summary.csv';
      link.href = URL.createObjectURL(blob);
      link.click();
      Toast.success('Summary exported');
    }

    if (format === 'trend-png') {
      const canvas = document.getElementById('m3-trend-chart');
      if (canvas) {
        const link = document.createElement('a');
        link.download = 'compliance-trend.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        Toast.success('Trend chart exported');
      }
    }

    if (format === 'session') {
      AppState.setResult('m3', this._results);
      Toast.success('Added to session export');
    }
  },

  _toggleFC() {
    const text = document.getElementById('m3-fc-text');
    if (text) text.style.display = text.style.display === 'none' ? '' : 'none';
  }
};
