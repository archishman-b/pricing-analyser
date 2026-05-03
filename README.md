# Pricing Analyser

**A browser-native pricing intelligence workbench for strategy professionals who have always had the frameworks but never had the tools.**

---

## The problem this solves

Strategy professionals — MBA-trained consultants, commercial analysts, pricing managers — routinely face high-stakes commercial questions: where is our margin leaking? Which sales reps are destroying pocket price? How much volume do we need to justify this price cut?

The tool landscape offers a binary choice: enterprise software that requires procurement, implementation, and an IT team; or Excel rebuilt from scratch on every engagement. The gap between these two options is where most commercial analysis happens — and where the most value gets left on the table.

SQL, Python, Tableau, Alteryx — powerful tools built for engineers. Pricefx, Vendavo — powerful tools requiring six-figure contracts and months of implementation. Neither serves the strategy professional who needs an answer before the next client meeting.

This tool is the middle layer that has never existed.

---

## What it does

The Pricing Analyser is a browser-based pricing intelligence workbench. Upload a transaction export (CSV or XLSX), map your columns once, and go from raw data to boardroom-ready pricing diagnostics in under an hour — without writing a line of code, without a Tableau licence, without a data engineering team.

### All 8 modules — v1.0

| Module | Group | What it produces |
|--------|-------|-----------------|
| **M1 — Price waterfall** | Diagnostic | Maps every discount layer from list to pocket price. Leakage by layer, account drill-down, floor price flagging, segment breakdown |
| **M2 — Price band analysis** | Diagnostic | OLS regression of discount % against legitimate factors. Identifies unwarranted discounting, quantifies recoverable margin by rep |
| **M3 — Discount governance** | Diagnostic | Live policy compliance monitoring. Violation heatmap, severity scoring, escalation flag list, compliance trend |
| **M4 — Margin decomposition** | Diagnostic | Breakeven analysis. 9-scenario what-if table. Breakeven curve −25% to +25%. Impossible-cut guard |
| **M5 — Economic value** | Strategic | EVE model, price floor/ceiling, skim/penetrate/neutral scoring, 9-factor sensitivity checklist, anchor simulator |
| **M6 — SaaS pricing studio** | Strategic | Pricing metric design, Van Westendorp PSM, ARR impact model, grandfathering planner, FREE! viability model, decoy designer, tone advisor |
| **M7 — Competitive intelligence** | Strategic | Price ladder, war risk assessment, match vs hold calculator, response framework |
| **M8 — Behavioural pricing lab** | Strategic | 8-bias audit (anchoring, decoy, FREE!, social norms, endowment, power of price, framing, complexity). No data required |

---

## How to use it

1. Open `pricing-analyser/index.html` in any modern browser
2. Click **Load data** and upload a CSV or XLSX transaction export — or click **Load sample data** to explore with synthetic NAPA-style B2B transaction data
3. Map your columns using the schema wizard (auto-suggested from column names)
4. Navigate to any module in the left sidebar
5. Export results as PNG charts or CSV tables — ready for PowerPoint or a client briefing

No installation. No account. No data upload to any server. Everything runs in your browser.

---

## Architecture

**Zero-server, browser-native.** Every analytical operation runs client-side in JavaScript. No server, no database, no authentication, no data upload. Data never leaves your machine.

This is not a technical constraint — it is a deliberate product decision. Pricing and commercial transaction data is among the most sensitive data a business holds. A consultant on a client engagement cannot upload transaction data to a third-party server. The zero-server architecture is what makes this tool usable on real work.

```
pricing-analyser/
├── index.html                   ← full application shell (77KB)
├── m1-waterfall.js              ← M1 price waterfall module
├── m4-margin.js                 ← M4 margin decomposition module
├── sample-b2b-transactions.csv  ← synthetic NAPA-style demo data
└── build-journal.html           ← full PM lifecycle documentation
```

Libraries loaded from CDN — no npm, no build pipeline:
`PapaParse 5.4` · `SheetJS 0.18` · `Chart.js 4.4` · `math.js 12` · `jsPDF 2.5`

---

## Who built this and why

12 years across Tata Motors, Mahindra, Monitor Deloitte, and Accenture. Pricing transformations, commercial architecture, XaaS transitions, post-M&A operating models.

The analytical work that drives real pricing decisions — waterfall analysis, leakage identification, discount governance, margin decomposition — was being done in bespoke Excel models built from scratch on every engagement. Models that took days to build, couldn't be handed off, and were discarded the moment the project closed.

The Pricing Analyser is the tool I needed on every engagement and never had.

---

## Build in public

This project is being built in public. The methodology behind every analytical decision is documented in the [build journal](build-journal.html) — the PM lifecycle, the architecture decisions, the consulting frameworks being operationalised.

---

## Companion tool

[DataBridge](../databridge/databridge.html) — a browser-based no-code data workbench for ingestion, joining, filtering, and transformation. The data layer that feeds the Pricing Analyser.

---

## Releases

| Version | Status | Contents |
|---------|--------|---------|
| **v1.0** | **Shipped** | All 8 modules · PDF session export · Onboarding wizard · Sample dataset |

---

*Built browser-native. Zero install. Data stays on your machine.*
