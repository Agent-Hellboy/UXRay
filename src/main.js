const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');

const { parseArgs, usage } = require('./cli');
const { TARGET_POLICIES, WAIT_UNTIL_OPTIONS } = require('./config');
const { nowTag, ensureDir } = require('./utils');
const {
  detectOverflow,
  detectTapTargets,
  sampleStyles,
  captureScrollShots,
  captureCrops,
  collectDomSignals,
  checkFocusVisibility,
  collectPerfSignals,
  checkReflow,
  runAxe,
} = require('./audits');
const { buildEvaluation } = require('./evaluation');
const { aggregateCounts, evaluateBudgets, generateHtml } = require('./report');

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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);

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
  const domSignals = await collectDomSignals(page);
  const perfSignals = await collectPerfSignals(page);
  const viewportMeta = await page.evaluate(() => Boolean(document.querySelector('meta[name="viewport"]')));
  const overflowCrops = await captureCrops(page, overflow.offenders, path.join(screenshotsDir, 'crops'), 'overflow');
  const tapCrops = await captureCrops(page, tapTargets.samples, path.join(screenshotsDir, 'crops'), 'tap');
  const shots = await captureScrollShots(page, screenshotsDir, emulateMobile ? 'mobile' : 'desktop', steps);
  const focusSignals = await checkFocusVisibility(page);
  const reflow = emulateMobile ? null : await checkReflow(page);
  const evaluation = buildEvaluation({
    overflow,
    tapTargets,
    styles,
    axe,
    domSignals,
    perfSignals,
    viewportMeta,
    reflow,
    consoleIssues,
    networkIssues,
    focusSignals,
    perf,
  });

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
    domSignals,
    focusSignals,
    perfSignals,
    reflow,
    evaluation,
    axe,
    screenshots: shots,
    overflowCrops,
    networkIssues,
    consoleIssues,
    trace: tracePath,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error(usage);
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

  const pkg = require('../package.json');
  const playwrightPkg = require('playwright/package.json');
  let axeVersion = null;
  try {
    axeVersion = require('@axe-core/playwright/package.json').version;
  } catch (err) {
    axeVersion = 'unknown';
  }

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
      axeVersion,
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

module.exports = {
  main,
};
