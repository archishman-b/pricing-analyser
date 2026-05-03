/**
 * M8 — Behavioural Pricing Lab
 * ─────────────────────────────────────────────────────────────────────────────
 * Stress-tests pricing structures against 8 buyer psychology biases.
 * No dataset required — runs entirely on manually entered pricing inputs.
 *
 * Biases implemented:
 * 1. Anchoring (Ariely Ch.2)
 * 2. Decoy effect (Ariely Ch.1)
 * 3. Zero price / FREE! effect (Ariely Ch.3)
 * 4. Social vs market norms (Ariely Ch.4)
 * 5. Endowment / loss aversion (Ariely Ch.7)
 * 6. Power of price / placebo effect (Ariely Ch.10)
 * 7. Framing & expectations (Ariely Ch.9)
 * 8. Option complexity / paralysis (Ariely Ch.8)
 */

'use strict';

const BehaviouralEngine = {

  /**
   * Run a full 8-bias diagnostic against a pricing structure.
   */
  audit(config) {
    const { tiers, hasAnchor, hasFreeElement, normContext, priceDisplay, existingCustomerPrice } = config;
    const results = [];

    // ── Bias 1: Anchoring ──────────────────────────────────────────────────
    const anchorRisk = hasAnchor === 'none' ? 3 : hasAnchor === 'low' ? 2 : 1;
    results.push({
      bias:    'Anchoring',
      score:   anchorRisk,
      finding: hasAnchor === 'none'
        ? 'No reference price is shown before your price. Buyers evaluate in a vacuum — WTP is anchored only by their own prior experiences, which may be lower than your price.'
        : hasAnchor === 'high'
        ? 'A higher reference price (MSRP, competitor, or previous price) is shown before yours. This is a strong positive anchor — your price will feel more acceptable in comparison.'
        : 'A lower reference price is shown first. This suppresses WTP. Consider whether to remove this anchor or reorder the price presentation.',
      recommendation: hasAnchor === 'none'
        ? 'Show a higher reference price (MSRP, full list, or competitor premium) before presenting your price.'
        : hasAnchor === 'high'
        ? 'Strong anchoring in place. Ensure the reference price is credible — implausible anchors backfire.'
        : 'Remove or reposition the low-price reference. If it must be shown, show it after your price, not before.',
      status: hasAnchor === 'high' ? 'good' : hasAnchor === 'none' ? 'warn' : 'risk'
    });

    // ── Bias 2: Decoy effect ───────────────────────────────────────────────
    if (tiers && tiers.length > 0) {
      const decoyAnalysis = this._analyseDecoy(tiers);
      results.push({
        bias:           'Decoy effect',
        score:          decoyAnalysis.hasDecoy ? 2 : 4,
        finding:        decoyAnalysis.finding,
        recommendation: decoyAnalysis.recommendation,
        status:         decoyAnalysis.hasDecoy ? 'good' : 'warn'
      });
    }

    // ── Bias 3: Zero price effect ──────────────────────────────────────────
    results.push({
      bias:    'Zero price (FREE!)',
      score:   hasFreeElement === 'yes' ? 1 : hasFreeElement === 'freemium' ? 2 : 4,
      finding: hasFreeElement === 'yes'
        ? 'A genuinely free element is present. The FREE! effect dramatically reduces perceived risk and increases conversion beyond what the price reduction alone would suggest.'
        : hasFreeElement === 'freemium'
        ? 'Freemium is in place. The FREE! effect drives initial adoption, but ensure the upgrade trigger is clear — freemium without a conversion moment just grows your free user base.'
        : 'No free element. Buyers face the full price barrier with no zero-cost entry point. For acquisition-stage products, consider a free trial or free tier to exploit the FREE! effect.',
      recommendation: hasFreeElement === 'yes'
        ? 'Verify the free element is genuinely free (no hidden commitments). The FREE! effect disappears if buyers perceive strings attached.'
        : hasFreeElement === 'freemium'
        ? 'Monitor free-to-paid conversion rate. If below 3%, the upgrade moment needs redesign.'
        : 'Introduce a free trial (time-limited) or a free tier (feature-limited) to lower the initial adoption barrier.',
      status: hasFreeElement === 'no' ? 'risk' : 'good'
    });

    // ── Bias 4: Social vs market norms ────────────────────────────────────
    const normRisk = normContext === 'relational' ? 2 : normContext === 'transactional' ? 1 : 3;
    results.push({
      bias:    'Social vs market norms',
      score:   normRisk,
      finding: normContext === 'relational'
        ? 'This is a relationship-based context (long-term accounts, enterprise, professional services). Introducing transactional fee language — per-seat charges, usage meters, overage penalties — risks contaminating the social norm with market norm logic, which buyers experience as a betrayal even for small amounts.'
        : normContext === 'transactional'
        ? 'This is a clearly transactional context. Market norms apply. Price sensitivity is higher but expectations are clear — buyers know what they\'re paying for and evaluate purely on value.'
        : 'Mixed context. Some elements are relational, some transactional. The risk is norm confusion — buyers don\'t know whether to evaluate you as a partner or a vendor.',
      recommendation: normContext === 'relational'
        ? 'Price as a flat subscription or annual commitment, not a usage meter. If usage-based pricing is necessary, frame it as a "consumption model" in the context of a partnership, not a transaction.'
        : normContext === 'transactional'
        ? 'Transactional pricing is appropriate here. Focus on clear value communication and price anchoring.'
        : 'Choose one norm context and commit to it throughout the pricing structure and sales communication.',
      status: normContext === 'mixed' ? 'warn' : 'good'
    });

    // ── Bias 5: Endowment / loss aversion ─────────────────────────────────
    const endowmentRisk = existingCustomerPrice === 'increasing' ? 4 : existingCustomerPrice === 'stable' ? 2 : 1;
    results.push({
      bias:    'Endowment & loss aversion',
      score:   endowmentRisk,
      finding: existingCustomerPrice === 'increasing'
        ? 'You are raising prices on existing customers. Loss aversion means they will experience this as a loss, not as paying a fair price. The psychological impact is 2× the magnitude of an equivalent gain. Customers who have "owned" their current price will resist disproportionately.'
        : existingCustomerPrice === 'stable'
        ? 'Prices are stable for existing customers. No endowment effect risk currently, but any future increases should be planned with loss aversion in mind.'
        : 'Pricing is being introduced fresh — no existing price to defend. The endowment effect will work in your favour once customers adopt.',
      recommendation: existingCustomerPrice === 'increasing'
        ? 'Frame increases as gaining new value, not paying more. Grandfathering (protecting existing price for a period) reduces resistance. Staged increases over multiple periods are psychologically easier than a single large jump. Give significant notice.'
        : existingCustomerPrice === 'stable'
        ? 'Document the current price clearly for customers now — so future increases can be framed as departures from an established baseline, not surprises.'
        : 'Onboard at a price customers will value. Free trials create endowment feelings that improve conversion and retention.',
      status: existingCustomerPrice === 'increasing' ? 'risk' : 'good'
    });

    // ── Bias 6: Power of price / placebo effect ────────────────────────────
    const pricePositionRisk = priceDisplay === 'premium' ? 1 : priceDisplay === 'discount' ? 3 : 2;
    results.push({
      bias:    'Power of price',
      score:   pricePositionRisk,
      finding: priceDisplay === 'premium'
        ? 'Your price is positioned as premium relative to alternatives. Higher prices signal quality and increase perceived efficacy — buyers who pay more report better results, independent of actual product differences. This is the placebo effect of price.'
        : priceDisplay === 'discount'
        ? 'Your price is positioned as a discount or bargain. This captures price-sensitive segments but reduces perceived quality and efficacy. In categories where outcome quality matters (professional services, health, B2B SaaS), discount pricing can suppress willingness to commit.'
        : 'Your price positioning is neutral — near market average. This avoids quality signal issues but leaves the premium signal opportunity uncaptured.',
      recommendation: priceDisplay === 'premium'
        ? 'Reinforce premium positioning throughout the purchase experience (packaging, onboarding, support quality). The price signal should match the experience.'
        : priceDisplay === 'discount'
        ? 'If quality is a key purchase driver, reconsider whether discount positioning is serving you. A modest price increase with stronger value communication may improve both revenue and perceived outcomes.'
        : 'Test whether a premium positioning (with value justification) improves conversion. In many B2B categories, buyers are suspicious of the cheapest option.',
      status: priceDisplay === 'discount' ? 'warn' : 'good'
    });

    // ── Bias 7: Framing & expectations ────────────────────────────────────
    const tierCount  = tiers ? tiers.length : 0;
    const midOption  = tierCount >= 3;
    results.push({
      bias:    'Framing & expectations',
      score:   midOption ? 2 : tierCount === 0 ? 3 : 4,
      finding: midOption
        ? 'Three or more tiers are present. A middle option is available — buyers exhibit a strong preference for middle options when faced with a range (extremeness aversion). This is the "compromise effect" and works in your favour.'
        : tierCount < 3 && tierCount > 0
        ? 'Fewer than 3 tiers. Without a middle option, buyers have no compromise choice. Most will anchor to the cheaper option.'
        : 'No tier structure — single price. No framing benefit available. Consider whether a second tier (even if rarely purchased) could anchor buyers to the primary price.',
      recommendation: midOption
        ? 'Ensure the tier you want buyers to choose is the middle option, not the most expensive. Price the top tier high enough to make the middle feel like exceptional value.'
        : 'Add a third tier above your primary target tier. Price it 40–60% above the primary. Few will buy it, but it will reframe your primary as a bargain.',
      status: midOption ? 'good' : 'warn'
    });

    // ── Bias 8: Option complexity / paralysis ──────────────────────────────
    const complexity = this._scoreComplexity(tiers);
    results.push({
      bias:    'Option complexity',
      score:   complexity.score,
      finding: complexity.finding,
      recommendation: complexity.recommendation,
      status: complexity.score <= 2 ? 'good' : complexity.score <= 3 ? 'warn' : 'risk'
    });

    const overallScore = results.reduce((s, r) => s + r.score, 0) / results.length;
    return { results, overallScore };
  },

  _analyseDecoy(tiers) {
    if (tiers.length < 2) return {
      hasDecoy: false,
      finding: 'Only one tier — no decoy effect possible.',
      recommendation: 'Add at least two tiers to enable comparison and the decoy effect.'
    };

    // Find if any tier is "dominated" (more expensive but comparable features to a cheaper tier)
    // Simple heuristic: if a middle tier is priced within 10% of a higher tier but has notably fewer features
    const prices = tiers.map(t => t.price);
    const sorted = [...prices].sort((a, b) => a - b);

    // Check if gaps between tiers are used constructively
    const hasLargeMidGap = sorted.length >= 3 &&
      (sorted[sorted.length - 1] - sorted[sorted.length - 2]) /
      (sorted[sorted.length - 1] - sorted[0]) > 0.6;

    return {
      hasDecoy: tiers.length >= 3,
      finding: tiers.length >= 3
        ? `Three tiers present. Potential decoy structure. ${hasLargeMidGap ? 'The top tier is priced significantly above the others — this creates a strong anchor effect making the middle tier look like exceptional value.' : 'Tier price gaps appear evenly distributed. Consider widening the gap between middle and top tiers to strengthen the decoy effect.'}`
        : 'Two tiers are present. No decoy tier. Buyers choose between cheap and expensive without a middle option to validate the primary choice.',
      recommendation: tiers.length >= 3
        ? 'Verify the tier you want buyers to choose looks like the best value when compared to the tier above and below it. The decoy should be comparable but inferior to the primary.'
        : 'Add a third tier priced above your primary target. This creates a decoy that makes the primary look like the rational choice.'
    };
  },

  _scoreComplexity(tiers) {
    if (!tiers || tiers.length === 0) return { score: 2, finding: 'No tiers defined.', recommendation: 'Define your tier structure above.' };

    const tierCount = tiers.length;
    const addOnCount = tiers.reduce((s, t) => s + (t.addOns || 0), 0);
    const totalOptions = tierCount + addOnCount;

    const score = totalOptions <= 3 ? 1
      : totalOptions <= 5 ? 2
      : totalOptions <= 8 ? 3
      : 4;

    return {
      score,
      finding: score <= 2
        ? `${totalOptions} decision points. Low option complexity — buyers can quickly identify the right tier without cognitive overload.`
        : score === 3
        ? `${totalOptions} decision points across tiers and add-ons. Moderate complexity. Some buyers may experience decision fatigue, particularly in self-serve flows.`
        : `${totalOptions} decision points. High complexity — option paralysis risk is real. Buyers faced with too many choices often delay or abandon the decision entirely.`,
      recommendation: score <= 2
        ? 'Option complexity is well-managed.'
        : score === 3
        ? 'Consider reducing add-ons or consolidating features into tiers. Each add-on adds a decision point that slows conversion.'
        : 'Simplify urgently. Reduce to 3 tiers maximum. Move add-ons into tiers. Feature the recommended tier prominently to short-circuit the paralysis.'
    };
  }
};


window.Module_m8 = {

  _tiers: [
    { name: 'Starter',    price: 49,  addOns: 0 },
    { name: 'Growth',     price: 149, addOns: 1 },
    { name: 'Enterprise', price: 399, addOns: 2 }
  ],
  _results: null,

  init() {
    const pane = document.getElementById('pane-m8');
    pane.innerHTML = `
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-eyebrow">Strategic design · Module 8</div>
          <div class="module-title">Behavioural pricing lab</div>
          <div class="module-desc">Stress-tests pricing structures against 8 buyer psychology biases. Identifies structural weaknesses before going to market. No data required.</div>
        </div>
        <div class="module-header-right">
          <span class="tag tag-phase-3">Phase 3</span>
          <span class="tag" style="background:var(--teal-lt);color:var(--teal)">No data required</span>
        </div>
      </div>

      <div class="framework-callout">
        <div class="fc-icon">◎</div>
        <div class="fc-body">
          <div class="fc-label">Framework — behavioural pricing</div>
          <div class="fc-text">Pricing is not just a rational decision — it is a perceptual one. The same price can feel expensive or reasonable depending on what came before it, how many alternatives exist, and whether the buyer feels like they own something being taken away. This lab applies 8 documented biases from experimental consumer psychology to your pricing structure.</div>
        </div>
      </div>

      <!-- Tier input -->
      <div class="config-panel">
        <div class="config-panel-header">
          <div class="config-panel-title">Your pricing structure</div>
          <button class="export-btn" onclick="Module_m8._addTier()" style="height:24px;font-size:10px">+ add tier</button>
        </div>
        <div id="m8-tiers-list">${this._renderTiers()}</div>

        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-2)">
          <div class="config-row">
            <div class="config-field">
              <label class="config-label">Anchor / reference price shown to buyers</label>
              <select class="config-select" id="m8-anchor">
                <option value="none">No reference price shown</option>
                <option value="high" selected>Higher reference shown first (MSRP/previous)</option>
                <option value="low">Lower reference shown first (competitor)</option>
              </select>
            </div>
            <div class="config-field">
              <label class="config-label">Free element</label>
              <select class="config-select" id="m8-free">
                <option value="yes">Genuinely free tier or plan</option>
                <option value="freemium">Free trial (time-limited)</option>
                <option value="no" selected>No free element</option>
              </select>
            </div>
            <div class="config-field">
              <label class="config-label">Relationship context</label>
              <select class="config-select" id="m8-norm">
                <option value="relational">Relational (enterprise / long-term)</option>
                <option value="transactional" selected>Transactional (self-serve / usage)</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div class="config-field">
              <label class="config-label">Existing customer pricing</label>
              <select class="config-select" id="m8-endowment">
                <option value="new">New customers only (no existing)</option>
                <option value="stable">Existing prices stable</option>
                <option value="increasing" selected>Raising prices on existing customers</option>
              </select>
            </div>
            <div class="config-field">
              <label class="config-label">Price positioning vs market</label>
              <select class="config-select" id="m8-price-pos">
                <option value="premium" selected>Premium (above market)</option>
                <option value="neutral">Neutral (at market)</option>
                <option value="discount">Discount (below market)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="config-run-row">
          <button class="btn-run" onclick="Module_m8.run()">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polygon points="3,1 11,6 3,11" fill="currentColor"/></svg>
            Run bias audit
          </button>
          <span class="run-hint">Evaluates your structure against 8 buyer psychology biases</span>
        </div>
      </div>

      <!-- Overall score -->
      <div id="m8-overall" style="display:none;margin-bottom:20px">
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 20px;display:flex;align-items:center;gap:20px">
          <div>
            <div style="font-size:10px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.07em;color:var(--tx-3);margin-bottom:4px">Overall risk score</div>
            <div class="stat-value" id="m8-overall-score" style="font-size:38px">—</div>
            <div id="m8-overall-label" style="font-size:12px;color:var(--tx-3);margin-top:2px"></div>
          </div>
          <div style="width:1px;height:48px;background:var(--border)"></div>
          <div style="display:flex;gap:14px">
            <div style="text-align:center">
              <div id="m8-count-good" style="font-size:22px;font-family:'Syne',sans-serif;font-weight:600;color:var(--teal)">—</div>
              <div style="font-size:10px;color:var(--tx-3)">strengths</div>
            </div>
            <div style="text-align:center">
              <div id="m8-count-warn" style="font-size:22px;font-family:'Syne',sans-serif;font-weight:600;color:var(--amber)">—</div>
              <div style="font-size:10px;color:var(--tx-3)">warnings</div>
            </div>
            <div style="text-align:center">
              <div id="m8-count-risk" style="font-size:22px;font-family:'Syne',sans-serif;font-weight:600;color:var(--red)">—</div>
              <div style="font-size:10px;color:var(--tx-3)">risks</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bias cards -->
      <div id="m8-bias-cards" style="display:none"></div>

      <!-- Framing comparator -->
      <div id="m8-framing" style="display:none;margin-top:20px">
        <div class="output-card">
          <div class="output-card-header">
            <div class="output-card-title">Price framing comparator — same price, 5 frames</div>
          </div>
          <div class="output-card-body" id="m8-framing-body"></div>
        </div>
      </div>

      <!-- Export bar -->
      <div class="export-bar" id="m8-export-bar" style="display:none">
        <span class="export-label">Export</span>
        <button class="export-btn" onclick="Module_m8.export('audit-csv')">Audit results CSV</button>
        <button class="export-btn add-to-session" onclick="Module_m8.export('session')">+ Add to session export</button>
      </div>
    `;

    // Auto-run with defaults
    setTimeout(() => this.run(), 150);
  },

  run() {
    const config = {
      tiers:                 this._tiers,
      hasAnchor:             document.getElementById('m8-anchor')?.value || 'none',
      hasFreeElement:        document.getElementById('m8-free')?.value || 'no',
      normContext:           document.getElementById('m8-norm')?.value || 'transactional',
      existingCustomerPrice: document.getElementById('m8-endowment')?.value || 'new',
      priceDisplay:          document.getElementById('m8-price-pos')?.value || 'neutral'
    };

    const results = BehaviouralEngine.audit(config);
    this._results = results;
    AppState.setResult('m8', results);
    this.render(results);
  },

  render(results) {
    const { results: biases, overallScore } = results;

    // Overall
    document.getElementById('m8-overall').style.display = '';
    const scoreEl = document.getElementById('m8-overall-score');
    scoreEl.textContent = overallScore.toFixed(1);
    scoreEl.style.color = overallScore <= 2 ? 'var(--teal)' : overallScore <= 3 ? 'var(--amber)' : 'var(--red)';
    document.getElementById('m8-overall-label').textContent = overallScore <= 2
      ? 'Strong structure — few psychological vulnerabilities'
      : overallScore <= 3
      ? 'Moderate risk — several biases working against you'
      : 'High risk — significant psychological vulnerabilities in the pricing structure';

    const counts = { good: biases.filter(b => b.status === 'good').length, warn: biases.filter(b => b.status === 'warn').length, risk: biases.filter(b => b.status === 'risk').length };
    document.getElementById('m8-count-good').textContent = counts.good;
    document.getElementById('m8-count-warn').textContent = counts.warn;
    document.getElementById('m8-count-risk').textContent = counts.risk;

    // Bias cards
    document.getElementById('m8-bias-cards').style.display = '';
    document.getElementById('m8-bias-cards').innerHTML = biases.map((b, i) => {
      const colour = b.status === 'good' ? 'var(--teal)' : b.status === 'warn' ? 'var(--amber)' : 'var(--red)';
      const bg     = b.status === 'good' ? 'var(--teal-lt)' : b.status === 'warn' ? 'var(--amber-lt)' : 'var(--red-lt)';
      const icon   = b.status === 'good' ? '✓' : b.status === 'warn' ? '⚠' : '✕';
      return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid ${colour};border-radius:0 var(--r-lg) var(--r-lg) 0;padding:14px 16px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div style="width:22px;height:22px;border-radius:50%;background:${bg};color:${colour};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0">${icon}</div>
            <div style="font-size:13px;font-weight:500;color:var(--tx-1);flex:1">${b.bias}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${colour}">${b.score}/5</div>
          </div>
          <div style="font-size:12px;color:var(--tx-2);line-height:1.7;margin-bottom:8px">${b.finding}</div>
          <div style="font-size:11px;color:${colour};background:${bg};border-radius:var(--r-md);padding:7px 10px;line-height:1.5">
            <strong>→</strong> ${b.recommendation}
          </div>
        </div>`;
    }).join('');

    // Framing comparator — use primary tier price
    if (this._tiers.length > 0) {
      const price = this._tiers.length >= 2 ? this._tiers[1].price : this._tiers[0].price;
      document.getElementById('m8-framing').style.display = '';
      this._renderFraming(price);
    }

    document.getElementById('m8-export-bar').style.display = '';
  },

  _renderFraming(price) {
    const frames = [
      { label: 'Absolute price',        text: '$' + price.toFixed(0) + '/month', desc: 'Neutral framing — no context, no comparison.' },
      { label: '% saving vs top tier',  text: (this._tiers.length >= 3 ? ((1 - price / this._tiers[this._tiers.length-1].price) * 100).toFixed(0) + '% less than ' + this._tiers[this._tiers.length-1].name : 'n/a'), desc: 'Saving frame — anchors to the more expensive option.' },
      { label: 'Per day',               text: '$' + (price / 30).toFixed(2) + '/day', desc: 'Disaggregated frame — makes the price feel trivially small.' },
      { label: 'Cost of not buying',    text: 'Less than one lost deal per year', desc: 'Opportunity cost frame — reframes the cost as an investment.' },
      { label: 'vs competitor',         text: 'Same as [Competitor] — with [Feature]', desc: 'Competitive frame — anchors to a known reference and highlights differentiation.' }
    ];

    document.getElementById('m8-framing-body').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;padding:4px 0">
        ${frames.map(f => `
          <div style="background:var(--bg-card-2);border-radius:var(--r-md);padding:12px 14px;border:1px solid var(--border)">
            <div style="font-size:10px;color:var(--tx-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${f.label}</div>
            <div style="font-size:16px;font-weight:600;font-family:'Syne',sans-serif;color:var(--accent);margin-bottom:6px">${f.text}</div>
            <div style="font-size:11px;color:var(--tx-3);line-height:1.5">${f.desc}</div>
          </div>`).join('')}
      </div>
    `;
  },

  _renderTiers() {
    return this._tiers.map((t, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input class="config-input" style="flex:1;height:28px;font-size:11px" placeholder="Tier name" value="${t.name}"
          oninput="Module_m8._tiers[${i}].name = this.value">
        <input class="config-input" type="number" style="width:90px;height:28px;font-size:11px;font-family:var(--font-mono)" placeholder="Price $"
          value="${t.price}" min="0" step="1"
          oninput="Module_m8._tiers[${i}].price = parseFloat(this.value)||0">
        <input class="config-input" type="number" style="width:70px;height:28px;font-size:11px" placeholder="Add-ons" title="Number of add-on options"
          value="${t.addOns || 0}" min="0" step="1"
          oninput="Module_m8._tiers[${i}].addOns = parseInt(this.value)||0">
        <div style="font-size:10px;color:var(--tx-3);width:50px">add-ons</div>
        <button onclick="Module_m8._removeTier(${i})" style="width:22px;height:22px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--tx-3);font-size:11px;cursor:pointer;flex-shrink:0">✕</button>
      </div>`).join('');
  },

  _addTier() {
    this._tiers.push({ name: 'New tier', price: 0, addOns: 0 });
    document.getElementById('m8-tiers-list').innerHTML = this._renderTiers();
  },

  _removeTier(i) {
    this._tiers.splice(i, 1);
    document.getElementById('m8-tiers-list').innerHTML = this._renderTiers();
  },

  export(format) {
    if (!this._results) { Toast.warning('Run the audit first'); return; }
    if (format === 'audit-csv') {
      const csv = [
        'bias,score,status,finding,recommendation',
        ...this._results.results.map(b =>
          [b.bias, b.score, b.status, '"' + b.finding.replace(/"/g,"'") + '"', '"' + b.recommendation.replace(/"/g,"'") + '"'].join(','))
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.download = 'behavioural-audit.csv';
      link.href = URL.createObjectURL(blob);
      link.click();
      Toast.success('Audit exported');
    }
    if (format === 'session') {
      AppState.setResult('m8', this._results);
      Toast.success('Added to session export');
    }
  }
};
