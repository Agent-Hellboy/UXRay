# UXRay

Fast UI/UX audit CLI for live web apps. Produces a JSON report plus evidence screenshots, and can emit an HTML summary.

## Prereqs
- Node.js 20+
- One-time browser install:

```bash
npx playwright install
```

## Install

```bash
npm install
```

Or run without installing (after cloning):

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

## CLI flags (high-value)
- `--url` target page (required)
- `--mobile` add iPhone 12 pass
- `--viewport 1440x900`
- `--steps` viewport screenshots while scrolling
- `--wait` extra settle time (ms)
- `--wait-until` load|domcontentloaded|networkidle|commit
- `--ready-selector` wait for selector after navigation
- `--target-policy` wcag22-aa | wcag21-aaa | lighthouse
- `--axe-tags` comma tags for axe rules
- `--html` emit HTML report (optional path)
- `--trace` capture Playwright trace
- Budget gates: `--max-a11y`, `--max-small-targets`, `--max-overflow`, `--max-console`, `--max-http-errors`

## Outputs
- JSON report: `reports/ui-report-<timestamp>.json`
- Screenshots: `reports/shots-<timestamp>/desktop|mobile`
- Optional HTML: `reports/ui-report-<timestamp>.html`
- Optional trace: `reports/shots-<timestamp>/desktop|mobile-trace.zip`
- Crops: `reports/shots-<timestamp>/desktop|mobile/crops/`

## CI & release
- GitHub Actions runs `npm run smoke` on PRs and publishes artifacts.
- Tag `v*.*.*` to publish to npm (requires `NPM_TOKEN`).
