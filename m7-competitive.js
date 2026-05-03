/**
 * M7 — Competitive Price Intelligence
 * ─────────────────────────────────────────────────────────────────────────────
 * Competitive price ladder, price war risk assessor,
 * price matching impact calculator, strategic response framework.
 */

'use strict';

const CompetitiveEngine = {

  /**
   * Price war risk scoring.
   * Returns a 0-100 risk score based on market structure indicators.
   */
  warRisk(inputs) {
    const { capacityUtilisation, marketConcentration, costSimilarity, strategicStakes, excessCapacity } = inputs;
    // Higher values = higher risk of retaliation
    const score = (
      capacityUtilisation   * 0.25 +
      (5 - marketConcentration) * 0.20 +  // fragmented market = higher war risk
      costSimilarity        * 0.20 +
      strategicStakes       * 0.25 +
      excessCapacity        * 0.10
    );
    const normalised = (score / 5) * 100;
    const label = normalised >= 70 ? 'High — retaliation likely'
      : normalised >= 45 ? 'Moderate — retaliation possible'
      : 'Low — retaliation unlikely';
    const recommendation = normalised >= 70
      ? 'A price cut is likely to trigger an aggressive response. Consider non-price competitive responses: service enhancement, bundling, or customer lock-in. If a price move is necessary, use targeted price actions (segment-specific, channel-specific) rather than a broad list price reduction.'
      : normalised >= 45
      ? 'Retaliation is possible but not certain. Signal intentions carefully — avoid moves that look like a land-grab. Consider a modest, justified price adjustment rather than an aggressive cut.'
      : 'Low retaliation risk. Market structure is not primed for a price war. A price move is less likely to trigger a spiral, but monitor competitor response closely in the first 60 days.';
    return { score: normalised, label, recommendation };
  },

  /**
   * Price matching impact: cost of matching vs not matching.
   */
  matchingImpact(params) {
    const { ourPrice, competitorPrice, ourVolume, ourCM, volumeLossIfNoMatch } = params;
    const priceGap     = ourPrice - competitorPrice;
    const priceGapPct  = priceGap / ourPrice;

    // Scenario A: match competitor price
    const matchNewCM    = ourCM - priceGap;
    const matchRevenue  = competitorPrice * ourVolume;
    const matchContrib  = matchNewCM * ourVolume;

    // Scenario B: don't match — lose some volume
    const noMatchVolume  = ourVolume * (1 - volumeLossIfNoMatch);
    const noMatchRevenue = ourPrice * noMatchVolume;
    const noMatchContrib = ourCM * noMatchVolume;

    const matchBetter = matchContrib > noMatchContrib;

    return {
      priceGap, priceGapPct,
      match:   { revenue: matchRevenue,  contribution: matchContrib,  newCM: matchNewCM },
      noMatch: { revenue: noMatchRevenue, contribution: noMatchContrib, volume: noMatchVolume },
      matchBetter,
      contributionDiff: matchContrib - noMatchContrib,
      breakEvenVolumeLoss: ourCM > 0 ? priceGap / ourCM : 0
    };
  }
};


window.Module_m7 = {

  _competitors: [
    { name: 'Competitor A', price: 85,  position: 'Premium',    notes: 'Full feature set' },
    { name: 'Competitor B', price: 65,  position: 'Mid-market', notes: 'Similar core product' },
    { name: 'Competitor C', price: 45,  position: 'Budget',     notes: 'Limited features' },
    { name: 'Our product',  price: 75,  position: 'Mid-market', notes: 'Target tier', isUs: true }
  ],
  _results: null,

  init() {
    const pane = document.getElementById('pane-m7');
    pane.innerHTML = `
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-eyebrow">Strategic design · Module 7</div>
          <div class="module-title">Competitive intelligence</div>
          <div class="module-desc">Competitive price ladder, price war risk assessment, price matching impact calculator, and strategic response framework.</div>
        </div>
        <div class="module-header-right">
          <span class="tag tag-phase-4">Phase 4</span>
          <span class="tag" style="background:var(--teal-lt);color:var(--teal)">No data required</span>
        </div>
      </div>

      <div class="framework-callout">
        <div class="fc-icon">◎</div>
        <div class="fc-body">
          <div class="fc-label">Framework — competitive response analysis</div>
          <div class="fc-text">The worst response to a competitor price cut is usually to match it immediately without analysis. Before reacting, three questions: will customers actually switch? What is the real cost of matching vs not matching? And is the competitor's move sustainable — or a sign of distress?</div>
        </div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:1px">
        ${['Price ladder','War risk','Match vs hold','Response framework'].map((t,i) =>
          `<button onclick="Module_m7._tab(${i})" id="m7-tab-${i}"
            style="font-size:12px;padding:7px 14px;border:none;border-bottom:${i===0?'2px solid var(--accent)':'2px solid transparent'};
            background:transparent;color:${i===0?'var(--accent)':'var(--tx-3)'};cursor:pointer;font-family:inherit">${t}</button>`
        ).join('')}
      </div>

      <!-- Tab 0: Price ladder -->
      <div id="m7-t0">
        <div class="config-panel">
          <div class="config-panel-header">
            <div class="config-panel-title">Competitive price ladder</div>
            <button class="export-btn" onclick="Module_m7._addCompetitor()" style="height:24px;font-size:10px">+ add competitor</button>
          </div>
          <div id="m7-competitors">${this._renderCompetitors()}</div>
          <div class="config-run-row">
            <button class="btn-run" onclick="Module_m7._runLadder()">Build ladder</button>
          </div>
        </div>
        <div id="m7-ladder-output" style="display:none;margin-top:16px">
          <div class="output-card">
            <div class="output-card-header">
              <div class="output-card-title">Price positioning — value vs price</div>
              <button class="output-card-export" onclick="Module_m7.export('ladder-png')">↓ PNG</button>
            </div>
            <div class="output-card-body" style="padding:12px 16px 16px">
              <canvas id="m7-ladder-chart" height="260"></canvas>
            </div>
          </div>
          <div id="m7-ladder-table" style="margin-top:14px"></div>
        </div>
      </div>

      <!-- Tab 1: War risk -->
      <div id="m7-t1" style="display:none">
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Price war risk factors — rate each 1–5</div></div>
          ${[
            ['capacityUtilisation',  'Competitor capacity utilisation',       '1=idle · 5=at capacity',    '1=low war risk · 5=high'],
            ['marketConcentration',  'Market concentration (HHI proxy)',      '1=fragmented · 5=oligopoly','5=low war risk · 1=high'],
            ['costSimilarity',       'Cost structure similarity',             '1=very different · 5=same', '1=low war risk · 5=high'],
            ['strategicStakes',      'Strategic importance of this segment',  '1=peripheral · 5=core',     '1=low war risk · 5=high'],
            ['excessCapacity',       'Industry excess capacity',              '1=tight · 5=severe',        '1=low war risk · 5=high']
          ].map(([id,label,hint,risk]) => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-2)">
              <div style="flex:1"><div style="font-size:12px;color:var(--tx-1)">${label}</div><div style="font-size:10px;color:var(--tx-3)">${hint}</div></div>
              <div style="font-size:10px;color:var(--tx-3);width:120px;text-align:right">${risk}</div>
              <input type="range" min="1" max="5" step="1" value="3" id="m7-wr-${id}"
                style="width:100px;accent-color:var(--accent)"
                oninput="document.getElementById('m7-wr-${id}-v').textContent=this.value">
              <div id="m7-wr-${id}-v" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent);width:14px">3</div>
            </div>`).join('')}
          <div class="config-run-row"><button class="btn-run" onclick="Module_m7._runWarRisk()">Assess war risk</button></div>
        </div>
        <div id="m7-war-output" style="display:none;margin-top:16px">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px">
            <div style="display:flex;align-items:center;gap:20px;margin-bottom:16px">
              <div class="stat-value" id="m7-war-score" style="font-size:48px">—</div>
              <div>
                <div id="m7-war-label" style="font-size:15px;font-weight:500;color:var(--tx-1);margin-bottom:6px">—</div>
                <div id="m7-war-rec" style="font-size:12px;color:var(--tx-2);line-height:1.7;max-width:520px"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 2: Match vs hold -->
      <div id="m7-t2" style="display:none">
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Price matching impact</div></div>
          <div class="config-row">
            <div class="config-field"><label class="config-label">Our current price ($)</label><input class="config-input" type="number" id="m7-mp-our" value="100" min="0"></div>
            <div class="config-field"><label class="config-label">Competitor new price ($)</label><input class="config-input" type="number" id="m7-mp-comp" value="85" min="0"></div>
            <div class="config-field"><label class="config-label">Our current volume (units/period)</label><input class="config-input" type="number" id="m7-mp-vol" value="1000" min="0"></div>
            <div class="config-field"><label class="config-label">Our contribution margin ($)</label><input class="config-input" type="number" id="m7-mp-cm" value="40" min="0"><div class="config-hint">Per unit CM at current price</div></div>
            <div class="config-field"><label class="config-label">Volume loss if we DON'T match (%)</label><input class="config-input" type="number" id="m7-mp-loss" value="15" min="0" max="100"><div class="config-hint">Your estimate of share loss if you hold price</div></div>
          </div>
          <div class="config-run-row"><button class="btn-run" onclick="Module_m7._runMatch()">Calculate impact</button></div>
        </div>
        <div id="m7-match-output" style="display:none;margin-top:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 20px" id="m7-match-card">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;color:var(--tx-3)">Scenario A — Match price</div>
              <div class="stat-value" id="m7-match-contrib" style="font-size:24px;margin-bottom:4px">—</div>
              <div style="font-size:11px;color:var(--tx-3);margin-bottom:8px">contribution</div>
              <div style="font-size:12px;color:var(--tx-2)" id="m7-match-rev">—</div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 20px" id="m7-hold-card">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;color:var(--tx-3)">Scenario B — Hold price</div>
              <div class="stat-value" id="m7-hold-contrib" style="font-size:24px;margin-bottom:4px">—</div>
              <div style="font-size:11px;color:var(--tx-3);margin-bottom:8px">contribution</div>
              <div style="font-size:12px;color:var(--tx-2)" id="m7-hold-vol">—</div>
            </div>
          </div>
          <div style="padding:12px 16px;background:var(--bg-card-2);border-radius:var(--r-md);font-size:12px;line-height:1.7" id="m7-match-interp"></div>
        </div>
      </div>

      <!-- Tab 3: Response framework -->
      <div id="m7-t3" style="display:none">
        <div class="config-panel">
          <div class="config-panel-header"><div class="config-panel-title">Strategic response decision</div></div>
          <div class="config-row">
            <div class="config-field">
              <label class="config-label">Competitor move type</label>
              <select class="config-select" id="m7-rf-move">
                <option value="cut">Price cut — broad market</option>
                <option value="cut_segment">Price cut — specific segment</option>
                <option value="new_low_tier">New low-end tier / product</option>
                <option value="promo">Promotional pricing</option>
                <option value="bundle">Bundling at lower effective price</option>
              </select>
            </div>
            <div class="config-field">
              <label class="config-label">Competitor likely motivation</label>
              <select class="config-select" id="m7-rf-motive">
                <option value="share">Market share grab</option>
                <option value="distress">Financial distress / desperation</option>
                <option value="clearance">Inventory clearance</option>
                <option value="entry">New segment entry</option>
                <option value="retaliation">Retaliation for our move</option>
              </select>
            </div>
            <div class="config-field">
              <label class="config-label">Our price sensitivity in affected segment</label>
              <select class="config-select" id="m7-rf-sensitivity">
                <option value="low">Low — customers buy on quality/relationship</option>
                <option value="medium">Medium — price is one of several factors</option>
                <option value="high">High — customers shop primarily on price</option>
              </select>
            </div>
          </div>
          <div class="config-run-row"><button class="btn-run" onclick="Module_m7._runResponse()">Generate response framework</button></div>
        </div>
        <div id="m7-response-output" style="display:none;margin-top:16px"></div>
      </div>

      <!-- Export bar -->
      <div class="export-bar" style="margin-top:20px">
        <span class="export-label">Export</span>
        <button class="export-btn" onclick="Module_m7.export('ladder-png')">Ladder chart PNG</button>
        <button class="export-btn add-to-session" onclick="Module_m7.export('session')">+ Add to session export</button>
      </div>
    `;

    this._ladderChart = null;
  },

  _tab(i) {
    for (let j = 0; j < 4; j++) {
      const p = document.getElementById('m7-t' + j);
      const b = document.getElementById('m7-tab-' + j);
      if (p) p.style.display = j === i ? '' : 'none';
      if (b) {
        b.style.borderBottom = j === i ? '2px solid var(--accent)' : '2px solid transparent';
        b.style.color        = j === i ? 'var(--accent)' : 'var(--tx-3)';
      }
    }
  },

  run() { this._tab(0); },

  _renderCompetitors() {
    return this._competitors.map((c, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input class="config-input" style="flex:1;height:28px;font-size:11px" placeholder="Name" value="${c.name}" oninput="Module_m7._competitors[${i}].name=this.value">
        <input class="config-input" type="number" style="width:80px;height:28px;font-size:11px;font-family:var(--font-mono)" placeholder="Price" value="${c.price}" oninput="Module_m7._competitors[${i}].price=parseFloat(this.value)||0">
        <input class="config-input" style="width:110px;height:28px;font-size:11px" placeholder="Position" value="${c.position}" oninput="Module_m7._competitors[${i}].position=this.value">
        <input class="config-input" style="flex:1;height:28px;font-size:11px" placeholder="Notes" value="${c.notes}" oninput="Module_m7._competitors[${i}].notes=this.value">
        <label style="font-size:10px;color:var(--accent);display:flex;align-items:center;gap:3px;white-space:nowrap;cursor:pointer">
          <input type="checkbox" ${c.isUs?'checked':''} style="accent-color:var(--accent)" onchange="Module_m7._competitors[${i}].isUs=this.checked"> Us
        </label>
        <button onclick="Module_m7._removeCompetitor(${i})" style="width:22px;height:22px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);font-size:11px;cursor:pointer;flex-shrink:0">✕</button>
      </div>`).join('');
  },

  _addCompetitor() {
    this._competitors.push({ name: 'New competitor', price: 0, position: '', notes: '', isUs: false });
    document.getElementById('m7-competitors').innerHTML = this._renderCompetitors();
  },

  _removeCompetitor(i) {
    this._competitors.splice(i, 1);
    document.getElementById('m7-competitors').innerHTML = this._renderCompetitors();
  },

  _runLadder() {
    if (this._ladderChart) { this._ladderChart.destroy(); this._ladderChart = null; }
    document.getElementById('m7-ladder-output').style.display = '';

    const sorted = [...this._competitors].sort((a, b) => a.price - b.price);
    const us     = sorted.find(c => c.isUs);
    const maxP   = Math.max(...sorted.map(c => c.price));

    // Render bar chart (horizontal)
    const ctx = document.getElementById('m7-ladder-chart').getContext('2d');
    this._ladderChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(c => c.name),
        datasets: [{
          label: 'Price',
          data:  sorted.map(c => c.price),
          backgroundColor: sorted.map(c => c.isUs ? 'rgba(200,169,110,0.7)' : 'rgba(168,167,162,0.3)'),
          borderColor:     sorted.map(c => c.isUs ? 'rgba(200,169,110,1)' : 'rgba(168,167,162,0.5)'),
          borderWidth: 1,
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
              label: item => item.dataset.data[item.dataIndex] ? '$' + item.dataset.data[item.dataIndex].toFixed(0) + (sorted[item.dataIndex]?.notes ? ' — ' + sorted[item.dataIndex].notes : '') : ''
            },
            backgroundColor: '#1E1E22', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
            titleColor: '#F0EFEC', bodyColor: '#A8A7A2', padding: 10, cornerRadius: 6
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#65635E', font: { size: 10 }, callback: v => '$' + v } },
          y: { grid: { display: false }, ticks: { color: '#A8A7A2', font: { size: 11 } } }
        }
      }
    });

    // Table
    document.getElementById('m7-ladder-table').innerHTML = `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>Competitor</th><th>Price</th><th>Position</th><th>Price gap to us</th><th>Notes</th></tr></thead>
          <tbody>
            ${sorted.map(c => {
              const gap = us ? c.price - us.price : 0;
              return `<tr style="${c.isUs?'background:rgba(200,169,110,0.05)':''}">
                <td style="color:${c.isUs?'var(--accent)':'var(--tx-1)'};font-weight:${c.isUs?'500':'400'}">${c.name}${c.isUs?' (us)':''}</td>
                <td class="td-num" style="color:${c.isUs?'var(--accent)':'var(--tx-2)'}">${UI.fmtCurrency(c.price)}</td>
                <td style="color:var(--tx-2)">${c.position}</td>
                <td class="td-num" style="color:${!c.isUs&&gap>0?'var(--teal)':!c.isUs&&gap<0?'var(--red)':'var(--tx-3)'}">${c.isUs?'—':(gap>0?'+':'')+(gap).toFixed(0)+' ('+(gap/us.price*100).toFixed(0)+'%)'}</td>
                <td style="color:var(--tx-3);font-size:11px">${c.notes}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    Toast.success('Price ladder built');
  },

  _runWarRisk() {
    const get = id => parseInt(document.getElementById('m7-wr-' + id)?.value || 3);
    const inputs = {
      capacityUtilisation:  get('capacityUtilisation'),
      marketConcentration:  get('marketConcentration'),
      costSimilarity:       get('costSimilarity'),
      strategicStakes:      get('strategicStakes'),
      excessCapacity:       get('excessCapacity')
    };
    const result = CompetitiveEngine.warRisk(inputs);
    document.getElementById('m7-war-output').style.display = '';
    const scoreEl = document.getElementById('m7-war-score');
    scoreEl.textContent = result.score.toFixed(0);
    scoreEl.style.color = result.score >= 70 ? 'var(--red)' : result.score >= 45 ? 'var(--amber)' : 'var(--teal)';
    document.getElementById('m7-war-label').textContent = result.label;
    document.getElementById('m7-war-label').style.color = result.score >= 70 ? 'var(--red)' : result.score >= 45 ? 'var(--amber)' : 'var(--teal)';
    document.getElementById('m7-war-rec').textContent = result.recommendation;
    AppState.setResult('m7_war', result);
    Toast.success('War risk assessed: ' + result.score.toFixed(0) + '/100');
  },

  _runMatch() {
    const params = {
      ourPrice:           parseFloat(document.getElementById('m7-mp-our')?.value) || 100,
      competitorPrice:    parseFloat(document.getElementById('m7-mp-comp')?.value) || 85,
      ourVolume:          parseInt(document.getElementById('m7-mp-vol')?.value) || 1000,
      ourCM:              parseFloat(document.getElementById('m7-mp-cm')?.value) || 40,
      volumeLossIfNoMatch:parseFloat(document.getElementById('m7-mp-loss')?.value) / 100 || 0.15
    };
    const r = CompetitiveEngine.matchingImpact(params);
    document.getElementById('m7-match-output').style.display = '';

    const matchEl = document.getElementById('m7-match-contrib');
    matchEl.textContent = UI.fmtCurrency(r.match.contribution, 0);
    matchEl.style.color = r.matchBetter ? 'var(--teal)' : 'var(--tx-2)';
    document.getElementById('m7-match-rev').textContent = 'Revenue: ' + UI.fmtCurrency(r.match.revenue, 0) + ' · New CM: ' + UI.fmtCurrency(r.match.newCM, 2);

    const holdEl = document.getElementById('m7-hold-contrib');
    holdEl.textContent = UI.fmtCurrency(r.noMatch.contribution, 0);
    holdEl.style.color = !r.matchBetter ? 'var(--teal)' : 'var(--tx-2)';
    document.getElementById('m7-hold-vol').textContent = 'Retained volume: ' + UI.fmtNum(Math.round(r.noMatch.volume)) + ' · Revenue: ' + UI.fmtCurrency(r.noMatch.revenue, 0);

    // Highlight winning scenario
    const winBorder = '2px solid var(--teal)';
    document.getElementById('m7-match-card').style.border = r.matchBetter ? winBorder : '1px solid var(--border)';
    document.getElementById('m7-hold-card').style.border  = !r.matchBetter ? winBorder : '1px solid var(--border)';

    const interpEl = document.getElementById('m7-match-interp');
    interpEl.innerHTML = r.matchBetter
      ? `<span style="color:var(--teal)">Matching is the better financial outcome</span> at the assumed ${(params.volumeLossIfNoMatch*100).toFixed(0)}% volume loss. The contribution difference is ${UI.fmtCurrency(Math.abs(r.contributionDiff), 0)}. However, matching signals to the competitor that price cuts will be met — which may invite further cuts. Consider whether a targeted match (specific customer or segment) rather than a broad list price change is sufficient to retain the at-risk volume.`
      : `<span style="color:var(--teal)">Holding price is the better financial outcome</span> at the assumed ${(params.volumeLossIfNoMatch*100).toFixed(0)}% volume loss. You can absorb up to <strong>${(r.breakEvenVolumeLoss*100).toFixed(1)}% volume loss</strong> before matching becomes economically rational. Focus retention efforts on the highest-value accounts at risk.`;

    AppState.setResult('m7_match', r);
    Toast.success('Impact calculated');
  },

  _runResponse() {
    const move        = document.getElementById('m7-rf-move')?.value;
    const motive      = document.getElementById('m7-rf-motive')?.value;
    const sensitivity = document.getElementById('m7-rf-sensitivity')?.value;
    const output      = document.getElementById('m7-response-output');
    output.style.display = '';

    const responses = {
      cut: {
        low:    { action: 'Hold & communicate value',    rationale: 'Your customers buy on quality and relationship. A broad price cut by a competitor rarely causes churn in low-sensitivity segments if the value differential is maintained. Invest in account management, not price matching.' },
        medium: { action: 'Selective matching + value investment', rationale: 'Match selectively for the highest-risk accounts. Introduce a lower-tier SKU or stripped-down offer for price-sensitive prospects. Do not reduce your primary list price — protect the premium positioning.' },
        high:   { action: 'Considered match with defined conditions', rationale: 'In high-sensitivity markets, a price gap of more than 15% to a credible competitor will cause share loss. Match if the gap exceeds your volume loss tolerance. Set a floor (minimum CM%) and hold it.' }
      },
      cut_segment: {
        low:    { action: 'Monitor — no immediate action', rationale: 'A segment-specific cut is unlikely to affect your core. Watch for spillover.' },
        medium: { action: 'Targeted counter-move in that segment only', rationale: 'Respond in-kind in the affected segment without contaminating your broader price book.' },
        high:   { action: 'Match in segment; defend adjacencies', rationale: 'Respond directly in the affected segment. Protect adjacent segments with lock-in mechanisms (contracts, switching costs).' }
      },
      new_low_tier: {
        low:    { action: 'Ignore — different buyer', rationale: 'A low-end entrant is not competing for your customers. Focus on your existing base.' },
        medium: { action: 'Monitor and introduce entry offer if needed', rationale: 'The low tier may attract buyers who would have grown into your product. Consider an entry offer to capture prospects before they form a relationship with the competitor.' },
        high:   { action: 'Introduce a flanker product', rationale: 'Launch a deliberately stripped-down version at a competitive price point. Keep it isolated from your core product to avoid cannibalisation.' }
      },
      distress: {
        low:    { action: 'Hold and wait', rationale: 'A price cut from a distressed competitor is unlikely to be sustained. Holding price preserves margin during the competitor\'s contraction.' },
        medium: { action: 'Hold and accelerate customer acquisition', rationale: 'A distressed competitor will lose customers, staff, and momentum. This is an opportunity to accelerate, not to match a price that won\'t persist.' },
        high:   { action: 'Hold and focus on competitor\'s customer base', rationale: 'Their customers are at risk — target them directly with outreach, not with a price cut that benefits your existing base.' }
      }
    };

    const resp = responses[move]?.[sensitivity] || responses[motive]?.[sensitivity] || {
      action: 'Assess and monitor',
      rationale: 'This combination of move type and sensitivity does not have a single recommended response. Prioritise understanding whether the competitor move is sustainable before committing to a response.'
    };

    const urgency = sensitivity === 'high' ? 'Respond within 2–4 weeks' : sensitivity === 'medium' ? 'Respond within 4–8 weeks' : 'Monitor for 4–6 weeks before deciding';

    output.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 24px">
        <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Recommended response</div>
        <div style="font-size:18px;font-weight:600;font-family:'Syne',sans-serif;color:var(--accent);margin-bottom:12px">${resp.action}</div>
        <div style="font-size:13px;color:var(--tx-2);line-height:1.7;margin-bottom:14px;padding:10px 14px;background:var(--bg-card-2);border-radius:var(--r-md)">${resp.rationale}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:140px;background:var(--bg-card-2);border-radius:var(--r-md);padding:10px 12px">
            <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Timing</div>
            <div style="font-size:13px;font-weight:500;color:var(--tx-1)">${urgency}</div>
          </div>
          <div style="flex:1;min-width:140px;background:var(--bg-card-2);border-radius:var(--r-md);padding:10px 12px">
            <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Competitor move</div>
            <div style="font-size:13px;font-weight:500;color:var(--tx-1)">${document.getElementById('m7-rf-move')?.options[document.getElementById('m7-rf-move').selectedIndex]?.text}</div>
          </div>
          <div style="flex:1;min-width:140px;background:var(--bg-card-2);border-radius:var(--r-md);padding:10px 12px">
            <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Motive</div>
            <div style="font-size:13px;font-weight:500;color:var(--tx-1)">${document.getElementById('m7-rf-motive')?.options[document.getElementById('m7-rf-motive').selectedIndex]?.text}</div>
          </div>
        </div>
      </div>`;
    Toast.success('Response framework generated');
  },

  export(format) {
    if (format === 'ladder-png') {
      const canvas = document.getElementById('m7-ladder-chart');
      if (!canvas || !this._ladderChart) { Toast.warning('Build the ladder first'); return; }
      const link = document.createElement('a');
      link.download = 'competitive-ladder.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      Toast.success('Ladder chart exported');
    }
    if (format === 'session') {
      AppState.setResult('m7', { competitors: this._competitors });
      Toast.success('Added to session export');
    }
  }
};
