#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const TARGET_POLICIES = {
  'wcag22-aa': { id: 'wcag22-aa', label: 'WCAG 2.2 AA Target Size Minimum', minSize: 24, spacing: 8 },
  'wcag21-aaa': { id: 'wcag21-aaa', label: 'WCAG 2.1 AAA Target Size', minSize: 44, spacing: 0 },
  lighthouse: { id: 'lighthouse', label: 'Lighthouse recommended tap target size', minSize: 48, spacing: 0 },
};

const WAIT_UNTIL_OPTIONS = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);

// Basic CLI arg parsing to keep dependencies light.
function parseArgs(argv) {
  const args = {
    url: null,
    mobile: false,
    width: 1280,
    height: 720,
    wait: 1500,
    waitUntil: 'load',
    readySelector: null,
    steps: 4,
    out: null,
    html: null,
    screenshots: null,
    targetPolicy: 'wcag21-aaa',
    axeTags: null,
    trace: false,
    budgetA11y: null,
    budgetTap: null,
    budgetOverflow: null,
    budgetConsole: null,
    budgetHttpErrors: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const val = argv[i];
    if (val === '--url' && argv[i + 1]) {
      args.url = argv[i + 1];
      i += 1;
    } else if (!val.startsWith('--') && !args.url) {
      args.url = val;
    } else if (val === '--mobile') {
      args.mobile = true;
    } else if (val === '--viewport' && argv[i + 1]) {
      const [w, h] = argv[i + 1].split('x');
      args.width = Number.parseInt(w, 10) || args.width;
      args.height = Number.parseInt(h, 10) || args.height;
      i += 1;
    } else if (val === '--wait' && argv[i + 1]) {
      args.wait = Number.parseInt(argv[i + 1], 10) || args.wait;
      i += 1;
    } else if (val === '--wait-until' && argv[i + 1]) {
      args.waitUntil = argv[i + 1];
      i += 1;
    } else if (val === '--ready-selector' && argv[i + 1]) {
      args.readySelector = argv[i + 1];
      i += 1;
    } else if (val === '--steps' && argv[i + 1]) {
      args.steps = Number.parseInt(argv[i + 1], 10) || args.steps;
      i += 1;
    } else if (val === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    } else if ((val === '--shots' || val === '--screenshots') && argv[i + 1]) {
      args.screenshots = argv[i + 1];
      i += 1;
    } else if (val === '--html') {
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args.html = argv[i + 1];
        i += 1;
      } else {
        args.html = true; // will resolve to default path later
      }
    } else if (val === '--target-policy' && argv[i + 1]) {
      args.targetPolicy = argv[i + 1];
      i += 1;
    } else if (val === '--axe-tags' && argv[i + 1]) {
      args.axeTags = argv[i + 1];
      i += 1;
    } else if (val === '--trace') {
      args.trace = true;
    } else if (val === '--max-a11y' && argv[i + 1]) {
      args.budgetA11y = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (val === '--max-small-targets' && argv[i + 1]) {
      args.budgetTap = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (val === '--max-overflow' && argv[i + 1]) {
      args.budgetOverflow = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (val === '--max-console' && argv[i + 1]) {
      args.budgetConsole = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (val === '--max-http-errors' && argv[i + 1]) {
      args.budgetHttpErrors = Number.parseInt(argv[i + 1], 10);
      i += 1;
    }
  }
  return args;
}

function nowTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function detectOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const hasOverflowX = doc.scrollWidth - doc.clientWidth > 2;
    const offenders = [];

    if (hasOverflowX) {
      const nodes = Array.from(document.querySelectorAll('body *'));
      const format = (el) => {
        const cls = typeof el.className === 'string' && el.className.trim()
          ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
        return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
      };

      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) continue;
        if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
          offenders.push({
            selector: format(el),
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              right: Math.round(rect.right),
            },
          });
          if (offenders.length >= 40) break;
        }
      }
    }

    return { hasOverflowX, offenders };
  });
}

async function detectTapTargets(page, policy) {
  const effectivePolicy = TARGET_POLICIES[policy] || TARGET_POLICIES['wcag21-aaa'];
  return page.evaluate((policyDef) => {
    const nodes = Array.from(
      document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"]'),
    );

    const tiny = [];
    const format = (el) => {
      const cls = typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
    };

    const rects = nodes.map((el) => ({ el, rect: el.getBoundingClientRect() })).filter(({ rect }) => rect?.width && rect?.height);

    const distanceBetween = (a, b) => {
      const dx = Math.max(0, Math.max(b.rect.left - a.rect.right, a.rect.left - b.rect.right));
      const dy = Math.max(0, Math.max(b.rect.top - a.rect.bottom, a.rect.top - b.rect.bottom));
      return Math.hypot(dx, dy);
    };

    rects.forEach((entry, idx) => {
      const { rect, el } = entry;
      const isBigEnough = rect.width >= policyDef.minSize && rect.height >= policyDef.minSize;
      if (isBigEnough) return;

      let spacedEnough = false;
      if (policyDef.spacing > 0) {
        let minGap = Infinity;
        for (let j = 0; j < rects.length; j += 1) {
          if (j === idx) continue;
          const gap = distanceBetween(entry, rects[j]);
          if (gap < minGap) minGap = gap;
          if (minGap < policyDef.spacing) break;
        }
        spacedEnough = minGap >= policyDef.spacing;
      }

      if (!spacedEnough) {
        tiny.push({
          selector: format(el),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          size: { width: Math.round(rect.width), height: Math.round(rect.height) },
          spacingOk: spacedEnough,
          text: (el.innerText || '').trim().slice(0, 80),
        });
      }
    });

    return {
      policy: policyDef,
      smallTargetCount: tiny.length,
      samples: tiny.slice(0, 30),
    };
  }, effectivePolicy);
}

async function sampleStyles(page) {
  return page.evaluate(() => {
    const toHex = (rgb) => {
      const parts = rgb.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
      if (!parts) return null;
      return `#${[1, 2, 3]
        .map((i) => Number(parts[i]).toString(16).padStart(2, '0'))
        .join('')}`;
    };

    const parseRgb = (rgb) => {
      const parts = rgb.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/i);
      if (!parts) return null;
      return {
        r: Number(parts[1]),
        g: Number(parts[2]),
        b: Number(parts[3]),
        a: parts[4] !== undefined ? Number(parts[4]) : 1,
      };
    };

    const relLuminance = ({ r, g, b }) => {
      const f = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    const contrastRatio = (fg, bg) => {
      const L1 = relLuminance(fg);
      const L2 = relLuminance(bg);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    };

    const colorCounts = new Map();
    const fontCounts = new Map();
    const contrastRisks = [];

    const elements = Array.from(document.querySelectorAll('body *')).slice(0, 400);

    elements.forEach((el, idx) => {
      const style = getComputedStyle(el);
      const fgHex = toHex(style.color);
      const bgHex = toHex(style.backgroundColor);
      const font = style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();

      if (fgHex) colorCounts.set(fgHex, (colorCounts.get(fgHex) || 0) + 1);
      if (bgHex && bgHex !== '#000000' && bgHex !== '#00000000') colorCounts.set(bgHex, (colorCounts.get(bgHex) || 0) + 1);
      if (font) fontCounts.set(font, (fontCounts.get(font) || 0) + 1);

      if (!el.textContent || !el.textContent.trim()) return;
      const fg = parseRgb(style.color);
      let bg = parseRgb(style.backgroundColor);
      if (!bg || bg.a === 0) {
        const bodyBg = parseRgb(getComputedStyle(document.body).backgroundColor);
        bg = bodyBg || { r: 255, g: 255, b: 255, a: 1 };
      }
      if (!fg || !bg) return;
      const ratio = contrastRatio(fg, bg);
      if (ratio < 4.5 && contrastRisks.length < 20) {
        const cls = typeof el.className === 'string' && el.className.trim()
          ? `.${el.className.trim().split(/\\s+/).slice(0, 2).join('.')}`
          : '';
        contrastRisks.push({ selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`, ratio: Number(ratio.toFixed(2)), sampleText: el.textContent.trim().slice(0, 60) });
      }
    });

    const topColors = Array.from(colorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([color, weight]) => ({ color, weight }));

    const topFonts = Array.from(fontCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([font, weight]) => ({ font, weight }));

    return { topColors, topFonts, contrastRisks };
  });
}

async function captureScrollShots(page, dir, prefix, steps) {
  const shotPaths = [];
  ensureDir(dir);

  const fullPath = path.join(dir, `${prefix}-full.png`);
  await page.screenshot({ path: fullPath, fullPage: true });
  shotPaths.push(fullPath);

  for (let i = 0; i < steps; i += 1) {
    const shotPath = path.join(dir, `${prefix}-v${i + 1}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    shotPaths.push(shotPath);

    const didReachEnd = await page.evaluate((step) => {
      const viewportHeight = window.innerHeight;
      const before = window.scrollY;
      window.scrollBy({ top: viewportHeight * 0.85, left: 0, behavior: 'instant' });
      return { before, after: window.scrollY, max: document.documentElement.scrollHeight - viewportHeight };
    }, i);

    if (didReachEnd.after >= didReachEnd.max) break;
    await page.waitForTimeout(500);
  }

  // Return relative paths so the report stays portable.
  return shotPaths.map((p) => path.relative(process.cwd(), p));
}

async function captureCrops(page, items, dir, prefix, limit = 8) {
  if (!items || !items.length) return [];
  ensureDir(dir);
  const docSize = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  const crops = [];
  const targets = items.slice(0, limit);
  for (let i = 0; i < targets.length; i += 1) {
    const rect = targets[i].rect;
    if (!rect || !rect.width || !rect.height) continue;
    const clip = {
      x: Math.max(0, rect.x - 4),
      y: Math.max(0, rect.y - 4),
      width: Math.min(rect.width + 8, docSize.width - rect.x),
      height: Math.min(rect.height + 8, docSize.height - rect.y),
    };
    if (clip.width <= 0 || clip.height <= 0) continue;
    const cropPath = path.join(dir, `${prefix}-${i + 1}.png`);
    await page.screenshot({ path: cropPath, clip });
    crops.push(path.relative(process.cwd(), cropPath));
  }
  return crops;
}

async function runAxe(page, { axeTags }) {
  let builder = new AxeBuilder({ page });
  if (axeTags && Array.isArray(axeTags) && axeTags.length) {
    builder = builder.withTags(axeTags);
  }
  const results = await builder.analyze();
  return {
    summary: {
      violations: results.violations.length,
      passes: results.passes.length,
      incomplete: results.incomplete.length,
    },
    topViolations: results.violations.slice(0, 10).map((v) => ({
      id: v.id,
      description: v.description,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  };
}

async function auditViewport(url, opts) {
  const {
    width,
    height,
    wait,
    waitUntil,
    readySelector,
    steps,
    screenshotsDir,
    emulateMobile,
    targetPolicy,
    axeTags,
    trace,
  } = opts;

  const browser = await chromium.launch({ headless: true });
  const context = emulateMobile
    ? await browser.newContext({ ...devices['iPhone 12'], viewport: devices['iPhone 12'].viewport })
    : await browser.newContext({ viewport: { width, height } });

  if (trace) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }

  const page = await context.newPage();
  const networkIssues = { failedRequests: [], httpErrors: [] };
  const consoleIssues = [];

  page.on('requestfailed', (req) => {
    networkIssues.failedRequests.push({
      url: req.url(),
      method: req.method(),
      error: req.failure()?.errorText,
      resourceType: req.resourceType(),
    });
  });

  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400) {
      networkIssues.httpErrors.push({
        url: res.url(),
        status,
        statusText: res.statusText(),
        method: res.request().method(),
        resourceType: res.request().resourceType(),
      });
    }
  });

  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      consoleIssues.push({ type: msg.type(), text: msg.text() });
    }
  });

  page.on('pageerror', (err) => {
    consoleIssues.push({ type: 'pageerror', text: err.message });
  });

  const navStart = Date.now();
  await page.goto(url, { waitUntil: WAIT_UNTIL_OPTIONS.has(waitUntil) ? waitUntil : 'load', timeout: 45000 });
  if (readySelector) {
    try {
      await page.waitForSelector(readySelector, { timeout: Math.max(wait, 5000) });
    } catch (err) {
      console.warn(`ready-selector '${readySelector}' not found before timeout`);
    }
  }
  await page.waitForTimeout(wait);

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    if (!nav) return null;
    return {
      domContentLoaded: nav.domContentLoadedEventEnd,
      load: nav.loadEventEnd,
      renderBlocking: nav.responseEnd,
    };
  });

  const overflow = await detectOverflow(page);
  const tapTargets = await detectTapTargets(page, targetPolicy);
  const styles = await sampleStyles(page);
  const axe = await runAxe(page, { axeTags });
  const viewportMeta = await page.evaluate(() => Boolean(document.querySelector('meta[name="viewport"]')));
  const shots = await captureScrollShots(page, screenshotsDir, emulateMobile ? 'mobile' : 'desktop', steps);
  const overflowCrops = await captureCrops(page, overflow.offenders, path.join(screenshotsDir, 'crops'), 'overflow');
  const tapCrops = await captureCrops(page, tapTargets.samples, path.join(screenshotsDir, 'crops'), 'tap');

  let tracePath = null;
  if (trace) {
    tracePath = path.join(screenshotsDir, `${emulateMobile ? 'mobile' : 'desktop'}-trace.zip`);
    await context.tracing.stop({ path: tracePath });
    tracePath = path.relative(process.cwd(), tracePath);
  }

  await browser.close();

  return {
    viewport: emulateMobile ? 'mobile iPhone 12' : `${width}x${height}`,
    navTimeMs: Date.now() - navStart,
    perf,
    overflow: { ...overflow, crops: overflowCrops },
    tapTargets: { ...tapTargets, crops: tapCrops },
    viewportMeta,
    styles: { ...styles },
    axe,
    screenshots: shots,
    overflowCrops,
    networkIssues,
    consoleIssues,
    trace: tracePath,
  };
}

function aggregateCounts(desktop, mobile) {
  const sum = (getter) => {
    const d = desktop ? getter(desktop) : 0;
    const m = mobile ? getter(mobile) : 0;
    return d + m;
  };

  return {
    a11yViolations: sum((r) => r.axe?.summary?.violations || 0),
    smallTargets: sum((r) => r.tapTargets?.smallTargetCount || 0),
    overflowOffenders: sum((r) => (r.overflow?.offenders || []).length),
    consoleIssues: sum((r) => (r.consoleIssues || []).length),
    httpErrors: sum((r) => (r.networkIssues?.httpErrors || []).length),
  };
}

function evaluateBudgets(counts, budgets) {
  const entries = [];
  const check = (key, label) => {
    const limit = budgets[key];
    if (limit === null || limit === undefined || Number.isNaN(limit)) return;
    const value = counts[key] || 0;
    const pass = value <= limit;
    entries.push({ key, label, value, limit, pass });
  };

  check('a11yViolations', 'Accessibility violations');
  check('smallTargets', 'Small tap targets');
  check('overflowOffenders', 'Overflow offenders');
  check('consoleIssues', 'Console issues');
  check('httpErrors', 'HTTP errors (4xx/5xx)');

  const ok = entries.every((e) => e.pass);
  return { ok, entries };
}

function generateHtml(report, outputPath) {
  const html = `<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\" />
  <title>UXRay report - ${report.url}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif; margin: 24px; color: #111; }
    h1 { margin-bottom: 4px; }
    .meta { color: #555; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 16px 0; }
    .card { border: 1px solid #e3e3e3; border-radius: 10px; padding: 12px 14px; background: #fafafa; }
    .card h3 { margin: 0 0 6px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ececec; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
    .pass { background: #e7f7e9; color: #0a8a2a; }
    .fail { background: #fdecea; color: #b32717; }
    .list { margin: 6px 0; padding-left: 18px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; }
  </style>
</head>
<body>
  <h1>UXRay Report</h1>
  <div class=\"meta\">URL: ${report.url}<br/>Run at: ${report.runAt}<br/>Config: ${report.config.viewport}, mobile: ${report.config.mobile}, waitUntil: ${report.config.waitUntil}</div>

  <div class=\"grid\">
    <div class=\"card\">
      <h3>Desktop</h3>
      <table>
        <tr><th>A11y violations</th><td>${report.desktop?.axe?.summary?.violations ?? '-'}</td></tr>
        <tr><th>Small targets</th><td>${report.desktop?.tapTargets?.smallTargetCount ?? '-'}</td></tr>
        <tr><th>Overflow offenders</th><td>${report.desktop?.overflow?.offenders?.length ?? '-'}</td></tr>
        <tr><th>HTTP errors</th><td>${report.desktop?.networkIssues?.httpErrors?.length ?? '-'}</td></tr>
        <tr><th>Console issues</th><td>${report.desktop?.consoleIssues?.length ?? '-'}</td></tr>
      </table>
    </div>
    ${report.mobile ? `<div class=\"card\">
      <h3>Mobile</h3>
      <table>
        <tr><th>A11y violations</th><td>${report.mobile?.axe?.summary?.violations ?? '-'}</td></tr>
        <tr><th>Small targets</th><td>${report.mobile?.tapTargets?.smallTargetCount ?? '-'}</td></tr>
        <tr><th>Overflow offenders</th><td>${report.mobile?.overflow?.offenders?.length ?? '-'}</td></tr>
        <tr><th>HTTP errors</th><td>${report.mobile?.networkIssues?.httpErrors?.length ?? '-'}</td></tr>
        <tr><th>Console issues</th><td>${report.mobile?.consoleIssues?.length ?? '-'}</td></tr>
      </table>
    </div>` : ''}
  </div>

  <div class=\"card\">
    <h3>Budgets</h3>
    <table>
      <tr><th>Item</th><th>Value</th><th>Limit</th><th>Status</th></tr>
      ${(report.budgets?.entries || []).map((e) => `<tr><td>${e.label}</td><td>${e.value}</td><td>${e.limit ?? '—'}</td><td><span class=\"badge ${e.pass ? 'pass' : 'fail'}\">${e.pass ? 'pass' : 'fail'}</span></td></tr>`).join('')}
    </table>
  </div>

  <div class=\"grid\">
    <div class=\"card\">
      <h3>Evidence</h3>
      <div>Desktop shots:</div>
      <ul class=\"list\">${(report.desktop?.screenshots || []).slice(0, 4).map((p) => `<li class=\"mono\">${p}</li>`).join('')}</ul>
      ${report.desktop?.overflow?.crops?.length ? `<div>Overflow crops:</div><ul class=\"list\">${report.desktop.overflow.crops.map((p) => `<li class=\"mono\">${p}</li>`).join('')}</ul>` : ''}
      ${report.desktop?.tapTargets?.crops?.length ? `<div>Tap target crops:</div><ul class=\"list\">${report.desktop.tapTargets.crops.map((p) => `<li class=\"mono\">${p}</li>`).join('')}</ul>` : ''}
      ${report.desktop?.trace ? `<div>Trace: <span class=\"mono\">${report.desktop.trace}</span></div>` : ''}
    </div>
    ${report.mobile ? `<div class=\"card\">
      <h3>Evidence (Mobile)</h3>
      <div>Shots:</div>
      <ul class=\"list\">${(report.mobile?.screenshots || []).slice(0, 4).map((p) => `<li class=\"mono\">${p}</li>`).join('')}</ul>
      ${report.mobile?.overflow?.crops?.length ? `<div>Overflow crops:</div><ul class=\"list\">${report.mobile.overflow.crops.map((p) => `<li class=\"mono\">${p}</li>`).join('')}</ul>` : ''}
      ${report.mobile?.tapTargets?.crops?.length ? `<div>Tap target crops:</div><ul class=\"list\">${report.mobile.tapTargets.crops.map((p) => `<li class=\"mono\">${p}</li>`).join('')}</ul>` : ''}
      ${report.mobile?.trace ? `<div>Trace: <span class=\"mono\">${report.mobile.trace}</span></div>` : ''}
    </div>` : ''}
  </div>
</body>
</html>`;

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, html, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error('Usage: node ui-review.js --url <https://your-app> [--mobile] [--viewport 1280x720] [--out report.json] [--html [path]] [--shots ./reports] [--wait-until load|domcontentloaded|networkidle] [--ready-selector <css>] [--target-policy wcag22-aa|wcag21-aaa|lighthouse] [--axe-tags wcag21aa,wcag2aa] [--trace] [--max-a11y N] [--max-small-targets N] [--max-overflow N] [--max-console N] [--max-http-errors N]');
    process.exit(1);
  }

  if (!WAIT_UNTIL_OPTIONS.has(args.waitUntil)) {
    console.warn(`Unknown wait-until '${args.waitUntil}', defaulting to 'load'`);
    args.waitUntil = 'load';
  }

  if (!TARGET_POLICIES[args.targetPolicy]) {
    console.warn(`Unknown target policy '${args.targetPolicy}', defaulting to wcag21-aaa (44px).`);
    args.targetPolicy = 'wcag21-aaa';
  }

  const axeTags = args.axeTags
    ? args.axeTags.split(',').map((t) => t.trim()).filter(Boolean)
    : null;

  const tag = nowTag();
  const shotsDir = args.screenshots || path.join(process.cwd(), 'reports', `shots-${tag}`);
  const outFile = args.out || path.join(process.cwd(), 'reports', `ui-report-${tag}.json`);
  const htmlFile = args.html ? (args.html === true ? path.join(process.cwd(), 'reports', `ui-report-${tag}.html`) : args.html) : null;
  ensureDir(path.dirname(outFile));
  ensureDir(shotsDir);
  if (htmlFile) ensureDir(path.dirname(htmlFile));

  const desktop = await auditViewport(args.url, {
    width: args.width,
    height: args.height,
    wait: args.wait,
    waitUntil: args.waitUntil,
    readySelector: args.readySelector,
    steps: args.steps,
    screenshotsDir: path.join(shotsDir, 'desktop'),
    emulateMobile: false,
    targetPolicy: args.targetPolicy,
    axeTags,
    trace: args.trace,
  });

  let mobile = null;
  if (args.mobile) {
    mobile = await auditViewport(args.url, {
      width: 390,
      height: 844,
      wait: args.wait,
      waitUntil: args.waitUntil,
      readySelector: args.readySelector,
      steps: Math.max(2, args.steps - 1),
      screenshotsDir: path.join(shotsDir, 'mobile'),
      emulateMobile: true,
      targetPolicy: args.targetPolicy,
      axeTags,
      trace: args.trace,
    });
  }

  const pkg = require('./package.json');
  const playwrightPkg = require('playwright/package.json');
  const axePkg = require('@axe-core/playwright/package.json');

  const report = {
    tool: { name: pkg.name || 'uxray', version: pkg.version || '0.0.0' },
    url: args.url,
    runAt: new Date().toISOString(),
    config: {
      wait: args.wait,
      waitUntil: args.waitUntil,
      readySelector: args.readySelector,
      viewport: `${args.width}x${args.height}`,
      steps: args.steps,
      mobile: args.mobile,
      targetPolicy: args.targetPolicy,
      axeTags,
      trace: args.trace,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    dependencies: {
      playwrightVersion: playwrightPkg.version,
      axeVersion: axePkg.version,
    },
    desktop,
    mobile,
    notes: {
      guidance: 'Focus on overflows, small tap targets (policy-driven), viewport meta (mobile), Axe violations, network/console errors. Automated scan; manual a11y review still required.',
      assets: 'See screenshot paths under screenshots[]. Trace zip present when --trace is used.',
    },
  };

  const budgets = {
    a11yViolations: Number.isFinite(args.budgetA11y) ? args.budgetA11y : null,
    smallTargets: Number.isFinite(args.budgetTap) ? args.budgetTap : null,
    overflowOffenders: Number.isFinite(args.budgetOverflow) ? args.budgetOverflow : null,
    consoleIssues: Number.isFinite(args.budgetConsole) ? args.budgetConsole : null,
    httpErrors: Number.isFinite(args.budgetHttpErrors) ? args.budgetHttpErrors : null,
  };

  const counts = aggregateCounts(desktop, mobile);
  const budgetResults = evaluateBudgets(counts, budgets);
  report.budgets = budgetResults;
  report.counts = counts;

  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  if (htmlFile) {
    generateHtml(report, htmlFile);
  }

  console.log(`UXRay complete for ${args.url}`);
  console.log(`Desktop: axe violations ${desktop.axe.summary.violations}, small tap targets ${desktop.tapTargets.smallTargetCount}, overflow ${desktop.overflow.hasOverflowX}`);
  if (mobile) {
    console.log(`Mobile: axe violations ${mobile.axe.summary.violations}, small tap targets ${mobile.tapTargets.smallTargetCount}, overflow ${mobile.overflow.hasOverflowX}`);
  }
  console.log(`Budgets: ${budgetResults.entries.length ? (budgetResults.ok ? 'pass' : 'fail') : 'none set'}`);
  console.log(`Report: ${path.relative(process.cwd(), outFile)}`);
  console.log(`Screenshots folder: ${path.relative(process.cwd(), shotsDir)}`);
  if (htmlFile) console.log(`HTML report: ${path.relative(process.cwd(), htmlFile)}`);

  if (!budgetResults.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('UXRay failed:', err);
  process.exit(1);
});
