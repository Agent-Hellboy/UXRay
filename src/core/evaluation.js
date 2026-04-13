const { clampScore } = require('../utils');
const { DEFAULT_POLICY } = require('./scoring-policy');

function buildEvaluation(input, policy = DEFAULT_POLICY) {
  const {
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
  } = input;

  const visualPolicy = policy.visual || {};
  const functionalPolicy = policy.functional || {};
  const a11yPolicy = policy.accessibility || {};
  const responsivePolicy = policy.responsive || {};
  const perfPolicy = policy.performance || {};
  const designPolicy = policy.designConsistency || {};
  const contentPolicy = policy.contentQuality || {};
  const statePolicy = policy.stateCoverage || {};
  const trustPolicy = policy.trustPolish || {};
  const regressionPolicy = policy.regressionRisk || {};

  const contrastCount = styles?.contrastRisks?.length || 0;
  const clippedCount = domSignals?.textClips?.length || 0;
  const overlapCount = domSignals?.coveredElements?.length || 0;
  const missingImages = domSignals?.missingImages?.length || 0;

  const visualScore = clampScore(100
    - (overflow?.offenders?.length || 0) * (visualPolicy.overflowPenalty ?? 2)
    - clippedCount * (visualPolicy.clippedPenalty ?? 2)
    - overlapCount * (visualPolicy.overlapPenalty ?? 1)
    - missingImages * (visualPolicy.missingImagePenalty ?? 5)
    - contrastCount * (visualPolicy.contrastPenalty ?? 1));
  const visualIssues = [];
  if (overflow?.hasOverflowX) visualIssues.push(`horizontal overflow (${overflow.offenders.length})`);
  if (clippedCount) visualIssues.push(`clipped text (${clippedCount})`);
  if (overlapCount) visualIssues.push(`overlapping/covered elements (${overlapCount})`);
  if (missingImages) visualIssues.push(`missing/broken images (${missingImages})`);
  if (contrastCount) visualIssues.push(`contrast risks (${contrastCount})`);

  const deadLinks = domSignals?.deadLinks?.length || 0;
  const buttonsNoText = domSignals?.buttonsNoText?.length || 0;
  const inputsMissingLabels = domSignals?.inputsMissingLabels?.length || 0;
  const formsWithoutSubmit = domSignals?.formsWithoutSubmit?.length || 0;
  const functionalScore = clampScore(100
    - deadLinks * (functionalPolicy.deadLinkPenalty ?? 2)
    - buttonsNoText * (functionalPolicy.buttonsNoTextPenalty ?? 2)
    - inputsMissingLabels * (functionalPolicy.inputsMissingLabelsPenalty ?? 2)
    - formsWithoutSubmit * (functionalPolicy.formsWithoutSubmitPenalty ?? 5));
  const functionalIssues = [];
  if (deadLinks) functionalIssues.push(`dead/placeholder links (${deadLinks})`);
  if (buttonsNoText) functionalIssues.push(`buttons without labels (${buttonsNoText})`);
  if (inputsMissingLabels) functionalIssues.push(`inputs missing labels (${inputsMissingLabels})`);
  if (formsWithoutSubmit) functionalIssues.push(`forms without submit (${formsWithoutSubmit})`);

  const axeViolations = axe?.summary?.violations || 0;
  const headingIssues = domSignals?.headingOrderIssues?.length || 0;
  const focusMissing = focusSignals?.missing?.length || 0;
  const smallTargets = tapTargets?.smallTargetCount || 0;
  const a11yScore = clampScore(100
    - axeViolations * (a11yPolicy.axePenalty ?? 5)
    - headingIssues * (a11yPolicy.headingPenalty ?? 5)
    - focusMissing * (a11yPolicy.focusPenalty ?? 2)
    - inputsMissingLabels * (a11yPolicy.unlabeledInputPenalty ?? 2)
    - smallTargets * (a11yPolicy.smallTargetPenalty ?? 1));
  const a11yIssues = [];
  if (axeViolations) a11yIssues.push(`axe violations (${axeViolations})`);
  if (headingIssues) a11yIssues.push(`heading order issues (${headingIssues})`);
  if (focusMissing) a11yIssues.push(`focus visibility missing (${focusMissing})`);
  if (inputsMissingLabels) a11yIssues.push(`unlabeled inputs (${inputsMissingLabels})`);
  if (smallTargets) a11yIssues.push(`small tap targets (${smallTargets})`);

  const reflowOverflow = reflow?.overflowX === true;
  const responsiveScore = clampScore(100
    - (viewportMeta ? 0 : (responsivePolicy.missingViewportPenalty ?? 20))
    - (reflowOverflow ? (responsivePolicy.reflowPenalty ?? 30) : 0)
    - smallTargets * (responsivePolicy.smallTargetPenalty ?? 1));
  const responsiveIssues = [];
  if (!viewportMeta) responsiveIssues.push('missing viewport meta');
  if (reflowOverflow) responsiveIssues.push('reflow overflow at 320px');
  if (smallTargets) responsiveIssues.push(`small tap targets (${smallTargets})`);

  const loadMs = perf?.load || 0;
  const dclMs = perf?.domContentLoaded || 0;
  const totalTransfer = perfSignals?.totalTransfer || 0;
  const largeImages = perfSignals?.largeImages || 0;
  const perfScore = clampScore(100
    - (loadMs > (perfPolicy.loadBadMs ?? 6000)
      ? (perfPolicy.loadBadPenalty ?? 20)
      : loadMs > (perfPolicy.loadWarnMs ?? 3000)
        ? (perfPolicy.loadWarnPenalty ?? 10)
        : 0)
    - (dclMs > (perfPolicy.dclWarnMs ?? 3000) ? (perfPolicy.dclWarnPenalty ?? 10) : 0)
    - (totalTransfer > (perfPolicy.transferBadBytes ?? 8_000_000)
      ? (perfPolicy.transferBadPenalty ?? 20)
      : totalTransfer > (perfPolicy.transferWarnBytes ?? 4_000_000)
        ? (perfPolicy.transferWarnPenalty ?? 10)
        : 0)
    - largeImages * (perfPolicy.largeImagePenalty ?? 2));
  const perfIssues = [];
  if (loadMs > 3000) perfIssues.push(`slow load (${Math.round(loadMs)}ms)`);
  if (dclMs > 3000) perfIssues.push(`slow DOMContentLoaded (${Math.round(dclMs)}ms)`);
  if (totalTransfer > 4_000_000) perfIssues.push(`large transfer ${(totalTransfer / 1_000_000).toFixed(1)}MB`);
  if (largeImages) perfIssues.push(`large images (${largeImages})`);

  const fontCount = styles?.fontCount || 0;
  const colorCount = styles?.colorCount || 0;
  const designScore = clampScore(100
    - Math.max(0, fontCount - (designPolicy.maxFonts ?? 3)) * (designPolicy.fontPenalty ?? 5)
    - Math.max(0, colorCount - (designPolicy.maxColors ?? 12)) * (designPolicy.colorPenalty ?? 1));
  const designIssues = [];
  if (fontCount > 3) designIssues.push(`many fonts (${fontCount})`);
  if (colorCount > 12) designIssues.push(`many colors (${colorCount})`);

  const loremCount = domSignals?.loremText?.length || 0;
  const genericCtas = domSignals?.genericCtas?.length || 0;
  const contentScore = clampScore(100
    - loremCount * (contentPolicy.loremPenalty ?? 5)
    - genericCtas * (contentPolicy.genericCtaPenalty ?? 2));
  const contentIssues = [];
  if (loremCount) contentIssues.push(`placeholder copy (${loremCount})`);
  if (genericCtas) contentIssues.push(`generic CTAs (${genericCtas})`);

  const stateSignals = domSignals?.stateSignals || {};
  const stateScore = clampScore((statePolicy.baseScore ?? 60)
    + Math.min(statePolicy.loadingCap ?? 20, (stateSignals.loadingHints || 0) * (statePolicy.loadingWeight ?? 2))
    + Math.min(statePolicy.errorCap ?? 10, (stateSignals.errorHints || 0) * (statePolicy.errorWeight ?? 2))
    + Math.min(statePolicy.ariaLiveCap ?? 10, (stateSignals.ariaLive || 0) * (statePolicy.ariaLiveWeight ?? 2)));
  const stateIssues = [];
  if ((stateSignals.loadingHints || 0) === 0) stateIssues.push('no loading indicators detected');
  if ((stateSignals.errorHints || 0) === 0) stateIssues.push('no error/alert indicators detected');

  const externalBlankNoRel = domSignals?.externalBlankNoRel?.length || 0;
  const trustScore = clampScore(100 - externalBlankNoRel * (trustPolicy.externalBlankPenalty ?? 2));
  const trustIssues = [];
  if (externalBlankNoRel) trustIssues.push(`external links missing rel=noopener (${externalBlankNoRel})`);

  const consoleCount = consoleIssues?.length || 0;
  const failedReqs = networkIssues?.failedRequests?.length || 0;
  const httpErrors = networkIssues?.httpErrors?.length || 0;
  const regressionScore = clampScore(100
    - consoleCount * (regressionPolicy.consolePenalty ?? 2)
    - failedReqs * (regressionPolicy.failedRequestPenalty ?? 2)
    - httpErrors * (regressionPolicy.httpErrorPenalty ?? 1));
  const regressionIssues = [];
  if (consoleCount) regressionIssues.push(`console issues (${consoleCount})`);
  if (failedReqs) regressionIssues.push(`failed requests (${failedReqs})`);
  if (httpErrors) regressionIssues.push(`http errors (${httpErrors})`);

  return {
    visual: { score: visualScore, issues: visualIssues },
    functional: { score: functionalScore, issues: functionalIssues },
    accessibility: { score: a11yScore, issues: a11yIssues },
    responsive: { score: responsiveScore, issues: responsiveIssues },
    performance: { score: perfScore, issues: perfIssues },
    designConsistency: { score: designScore, issues: designIssues },
    contentQuality: { score: contentScore, issues: contentIssues },
    stateCoverage: { score: stateScore, issues: stateIssues, confidence: 'low' },
    trustPolish: { score: trustScore, issues: trustIssues },
    regressionRisk: { score: regressionScore, issues: regressionIssues },
  };
}

module.exports = {
  buildEvaluation,
};
