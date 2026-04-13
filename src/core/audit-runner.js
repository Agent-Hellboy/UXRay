const path = require('path');
const { detectOverflow, detectTapTargets, checkReflow } = require('../audits/layout');
const { sampleStyles } = require('../audits/style');
const { captureScrollShots, captureCrops } = require('../evidence');
const { collectDomSignals, checkFocusVisibility } = require('../audits/dom');
const { collectNavigationPerf, collectPerfSignals } = require('../perf');
const { runAxe } = require('../audits/a11y');
const { buildEvaluation } = require('./evaluation');

async function collectMetrics(page, opts) {
  const perf = await collectNavigationPerf(page);
  const overflow = await detectOverflow(page);
  const tapTargets = await detectTapTargets(page, opts.targetPolicy);
  const styles = await sampleStyles(page);
  const axe = await runAxe(page, { axeTags: opts.axeTags });
  const domSignals = await collectDomSignals(page);
  const perfSignals = await collectPerfSignals(page);
  const viewportMeta = await page.evaluate(() => Boolean(document.querySelector('meta[name="viewport"]')));

  return {
    perf,
    overflow,
    tapTargets,
    styles,
    axe,
    domSignals,
    perfSignals,
    viewportMeta,
  };
}

async function collectEvidence(page, opts, metrics) {
  const overflowCrops = await captureCrops(page, metrics.overflow.offenders, path.join(opts.screenshotsDir, 'crops'), 'overflow');
  const tapCrops = await captureCrops(page, metrics.tapTargets.samples, path.join(opts.screenshotsDir, 'crops'), 'tap');
  const shots = await captureScrollShots(page, opts.screenshotsDir, opts.emulateMobile ? 'mobile' : 'desktop', opts.steps);
  const focusSignals = await checkFocusVisibility(page);
  const reflow = opts.emulateMobile ? null : await checkReflow(page);

  return {
    overflowCrops,
    tapCrops,
    shots,
    focusSignals,
    reflow,
  };
}

async function runAuditPipeline(page, opts) {
  const metrics = await collectMetrics(page, opts);
  const evidence = await collectEvidence(page, opts, metrics);
  const evaluation = buildEvaluation({
    overflow: metrics.overflow,
    tapTargets: metrics.tapTargets,
    styles: metrics.styles,
    axe: metrics.axe,
    domSignals: metrics.domSignals,
    perfSignals: metrics.perfSignals,
    viewportMeta: metrics.viewportMeta,
    reflow: evidence.reflow,
    consoleIssues: opts.consoleIssues,
    networkIssues: opts.networkIssues,
    focusSignals: evidence.focusSignals,
    perf: metrics.perf,
  });

  return {
    ...metrics,
    ...evidence,
    evaluation,
  };
}

module.exports = {
  runAuditPipeline,
};
