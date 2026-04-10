#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

// Basic CLI arg parsing to keep dependencies light.
function parseArgs(argv) {
  const args = {
    url: null,
    mobile: false,
    width: 1280,
    height: 720,
    wait: 1500,
    steps: 4,
    out: null,
    screenshots: null,
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
    } else if (val === '--steps' && argv[i + 1]) {
      args.steps = Number.parseInt(argv[i + 1], 10) || args.steps;
      i += 1;
    } else if (val === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    } else if ((val === '--shots' || val === '--screenshots') && argv[i + 1]) {
      args.screenshots = argv[i + 1];
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

async function detectTapTargets(page) {
  return page.evaluate(() => {
    const MIN_SIZE = 44; // WCAG touch target size guideline in px
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

    nodes.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        tiny.push({
          selector: format(el),
          size: { width: Math.round(rect.width), height: Math.round(rect.height) },
          text: (el.innerText || '').trim().slice(0, 80),
        });
      }
    });

    return { smallTargetCount: tiny.length, samples: tiny.slice(0, 30) };
  });
}

async function sampleStyles(page) {
  return page.evaluate(() => {
    const toHex = (rgb) => {
      const parts = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!parts) return null;
      return `#${[1, 2, 3]
        .map((i) => Number(parts[i]).toString(16).padStart(2, '0'))
        .join('')}`;
    };

    const colorCounts = new Map();
    const fontCounts = new Map();
    const elements = Array.from(document.querySelectorAll('body *')).slice(0, 400);

    elements.forEach((el) => {
      const style = getComputedStyle(el);
      const fg = toHex(style.color);
      const bg = toHex(style.backgroundColor);
      const font = style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();

      if (fg) colorCounts.set(fg, (colorCounts.get(fg) || 0) + 1);
      if (bg && bg !== '#000000' && bg !== '#00000000') colorCounts.set(bg, (colorCounts.get(bg) || 0) + 1);
      if (font) fontCounts.set(font, (fontCounts.get(font) || 0) + 1);
    });

    const topColors = Array.from(colorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([color, weight]) => ({ color, weight }));

    const topFonts = Array.from(fontCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([font, weight]) => ({ font, weight }));

    return { topColors, topFonts };
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

async function runAxe(page) {
  const results = await new AxeBuilder({ page }).analyze();
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
  const { width, height, wait, steps, screenshotsDir, emulateMobile } = opts;
  const browser = await chromium.launch({ headless: true });
  const context = emulateMobile
    ? await browser.newContext({ ...devices['iPhone 12'], viewport: devices['iPhone 12'].viewport })
    : await browser.newContext({ viewport: { width, height } });

  const page = await context.newPage();
  const networkIssues = [];
  const consoleIssues = [];

  page.on('requestfailed', (req) => {
    networkIssues.push({ url: req.url(), method: req.method(), error: req.failure()?.errorText });
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
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
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
  const tapTargets = await detectTapTargets(page);
  const styles = await sampleStyles(page);
  const axe = await runAxe(page);
  const viewportMeta = await page.evaluate(() => Boolean(document.querySelector('meta[name="viewport"]')));
  const shots = await captureScrollShots(page, screenshotsDir, emulateMobile ? 'mobile' : 'desktop', steps);

  await browser.close();

  return {
    viewport: emulateMobile ? 'mobile iPhone 12' : `${width}x${height}`,
    navTimeMs: Date.now() - navStart,
    perf,
    overflow,
    tapTargets,
    viewportMeta,
    styles,
    axe,
    screenshots: shots,
    networkIssues,
    consoleIssues,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error('Usage: node ui-review.js --url <https://your-app> [--mobile] [--viewport 1280x720] [--out report.json] [--shots ./reports]');
    process.exit(1);
  }

  const tag = nowTag();
  const shotsDir = args.screenshots || path.join(process.cwd(), 'reports', `shots-${tag}`);
  const outFile = args.out || path.join(process.cwd(), 'reports', `ui-report-${tag}.json`);
  ensureDir(path.dirname(outFile));
  ensureDir(shotsDir);

  const desktop = await auditViewport(args.url, {
    width: args.width,
    height: args.height,
    wait: args.wait,
    steps: args.steps,
    screenshotsDir: path.join(shotsDir, 'desktop'),
    emulateMobile: false,
  });

  let mobile = null;
  if (args.mobile) {
    mobile = await auditViewport(args.url, {
      width: 390,
      height: 844,
      wait: args.wait,
      steps: Math.max(2, args.steps - 1),
      screenshotsDir: path.join(shotsDir, 'mobile'),
      emulateMobile: true,
    });
  }

  const report = {
    url: args.url,
    runAt: new Date().toISOString(),
    desktop,
    mobile,
    notes: {
      guidance: 'Focus on horizontal overflows, small tap targets (<44px), missing viewport meta (mobile), Axe violations, and network/console errors.',
      assets: 'See screenshot paths under screenshots[].',
    },
  };

  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log(`UXRay complete for ${args.url}`);
  console.log(`Desktop: axe violations ${desktop.axe.summary.violations}, small tap targets ${desktop.tapTargets.smallTargetCount}, overflow ${desktop.overflow.hasOverflowX}`);
  if (mobile) {
    console.log(`Mobile: axe violations ${mobile.axe.summary.violations}, small tap targets ${mobile.tapTargets.smallTargetCount}, overflow ${mobile.overflow.hasOverflowX}`);
  }
  console.log(`Report: ${path.relative(process.cwd(), outFile)}`);
  console.log(`Screenshots folder: ${path.relative(process.cwd(), shotsDir)}`);
}

main().catch((err) => {
  console.error('UXRay failed:', err);
  process.exit(1);
});
