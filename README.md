# UXRay

Audit any hosted web app for quick UI/UX health:

- Layout issues: horizontal overflow offenders, scroll snapshots.
- Touch ergonomics: configurable policies (24px/44px/48px) with spacing-aware detection.
- Accessibility: runs axe-core via Playwright.
- Theme diagnostics: top colors/fonts plus low-contrast samples.
- Stability: logs console errors/warnings, failed network requests, and HTTP 4xx/5xx responses.
- Evidence: full-page + stepped viewport screenshots, issue crops, optional trace zips, optional HTML report.

## Prereqs
- Node.js 20+ (aligned with current Playwright requirements).
- One-time: download bundled browsers

```bash
npx playwright install
```

## Install

```bash
npm install
```

Or run directly after cloning with `npx` (no global install):

```bash
npx uxray --url https://example.com
```

## Usage

```bash
npm run review -- --url https://your-app.com \
  --mobile \
  --viewport 1366x768 \
  --steps 4 \
  --wait 2000 \
  --wait-until load \
  --ready-selector '#app' \
  --target-policy wcag22-aa \
  --axe-tags wcag21aa,wcag2aa \
  --html \
  --max-a11y 5 \
  --max-small-targets 10 \
  --max-overflow 2 \
  --max-console 3 \
  --max-http-errors 0 \
  --trace \
  --out ./reports/uxray-report.json \
  --shots ./reports/shots
```

Short flags:
- `--url` (required) target page.
- `--mobile` also run an iPhone 12 emulation pass.
- `--viewport` desktop viewport, e.g. `1440x900` (default 1280x720).
- `--steps` number of viewport screenshots while scrolling (default 4).
- `--wait` extra ms to settle after load (default 1500ms).
- `--wait-until` Playwright navigation readiness (`load` default, `domcontentloaded`, `networkidle`, `commit`).
- `--ready-selector` wait for a CSS selector after navigation (useful for SPAs).
- `--out` output report path (JSON).
- `--html` also emit a shareable HTML report (optional path argument).
- `--shots` screenshots root folder.
- `--target-policy` tap target preset: `wcag22-aa` (24px + spacing), `wcag21-aaa` (44px), `lighthouse` (48px recommendation).
- `--axe-tags` comma-separated axe rule tags (e.g., `wcag21aa,wcag2aa`).
- `--trace` also capture a Playwright trace zip per run for deep debugging.
- Budgets / CI gates (exit non-zero on fail):
  - `--max-a11y <n>`
  - `--max-small-targets <n>`
  - `--max-overflow <n>`
  - `--max-console <n>`
  - `--max-http-errors <n>`

After a run you’ll see:
- `reports/ui-report-<timestamp>.json` with counts and offenders.
- `reports/shots-<timestamp>/desktop|mobile` PNGs.
- If `--trace` is used: `reports/shots-<timestamp>/desktop|mobile-trace.zip` for replay in Playwright Trace Viewer.
- If `--html` is used: `reports/ui-report-<timestamp>.html` with a quick summary and evidence links.
- Crops for top overflow/tap issues live under `reports/shots-<timestamp>/desktop|mobile/crops/`.

## CI & release
- GitHub Actions workflow (`.github/workflows/ci.yml`) runs a Playwright-backed smoke against `https://example.com` and publishes smoke artifacts.
- To publish on tag `v*.*.*`, add repo secret `NPM_TOKEN` with publish rights; tagging triggers `npm publish --provenance`.

Tap target policy notes:
- `wcag22-aa`: flags targets smaller than 24×24px unless they have generous spacing from neighbors (approximate spacing check).
- `wcag21-aaa`: classic 44×44px minimum.
- `lighthouse`: 48×48px guidance.

## JSON report shape (excerpt)

```json
{
  "url": "https://example.com",
  "runAt": "2026-04-10T18:00:00.000Z",
  "desktop": {
    "viewport": "1280x720",
    "navTimeMs": 2310,
    "perf": { "domContentLoaded": 980, "load": 1500, "renderBlocking": 210 },
    "overflow": { "hasOverflowX": false, "offenders": [] },
    "tapTargets": { "smallTargetCount": 2, "samples": [...] },
    "viewportMeta": true,
    "styles": { "topColors": [...], "topFonts": [...] },
    "axe": { "summary": { "violations": 3, "passes": 150, "incomplete": 0 }, "topViolations": [...] },
    "screenshots": ["reports/shots.../desktop-full.png", "..."],
    "networkIssues": [],
    "consoleIssues": []
  },
  "mobile": { ... }
}
```

## Notes
- Tool runs headless; remove `headless: true` in `ui-review.js` if you want to watch it.
- If Playwright can’t launch browsers on macOS due to permissions, try running outside sandboxed shells or re-run `npx playwright install`.
- Reports and screenshots are git-ignored.
