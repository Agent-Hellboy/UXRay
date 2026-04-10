# UXRay

Audit any hosted web app for quick UI/UX health:

- Layout issues: horizontal overflow offenders, scroll snapshots.
- Touch ergonomics: finds tap targets smaller than 44px.
- Accessibility: runs axe-core via Playwright.
- Theme signals: samples top colors and fonts.
- Stability: logs console errors/warnings and failed network requests.
- Evidence: full-page + stepped viewport screenshots.

## Prereqs
- Node.js 18+ (Playwright uses modern APIs).
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
npx ./ui-review.js --url https://example.com
```

## Usage

```bash
npm run review -- --url https://your-app.com \
  --mobile \
  --viewport 1366x768 \
  --steps 4 \
  --wait 2000 \
  --out ./reports/uxray-report.json \
  --shots ./reports/shots
```

Short flags:
- `--url` (required) target page.
- `--mobile` also run an iPhone 12 emulation pass.
- `--viewport` desktop viewport, e.g. `1440x900` (default 1280x720).
- `--steps` number of viewport screenshots while scrolling (default 4).
- `--wait` extra ms to settle after load (default 1500ms).
- `--out` output report path (JSON).
- `--shots` screenshots root folder.

After a run you’ll see:
- `reports/ui-report-<timestamp>.json` with counts and offenders.
- `reports/shots-<timestamp>/desktop|mobile` PNGs.

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
