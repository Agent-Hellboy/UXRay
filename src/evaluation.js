const { clampScore } = require('./utils');

function buildEvaluation(input) {
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

  const contrastCount = styles?.contrastRisks?.length || 0;
  const clippedCount = domSignals?.textClips?.length || 0;
  const overlapCount = domSignals?.coveredElements?.length || 0;
  const missingImages = domSignals?.missingImages?.length || 0;

  const visualScore = clampScore(100
    - (overflow?.offenders?.length || 0) * 2
    - clippedCount * 2
    - overlapCount * 1
    - missingImages * 5
    - contrastCount * 1);
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
  const functionalScore = clampScore(100 - deadLinks * 2 - buttonsNoText * 2 - inputsMissingLabels * 2 - formsWithoutSubmit * 5);
  const functionalIssues = [];
  if (deadLinks) functionalIssues.push(`dead/placeholder links (${deadLinks})`);
  if (buttonsNoText) functionalIssues.push(`buttons without labels (${buttonsNoText})`);
  if (inputsMissingLabels) functionalIssues.push(`inputs missing labels (${inputsMissingLabels})`);
  if (formsWithoutSubmit) functionalIssues.push(`forms without submit (${formsWithoutSubmit})`);

  const axeViolations = axe?.summary?.violations || 0;
  const headingIssues = domSignals?.headingOrderIssues?.length || 0;
  const focusMissing = focusSignals?.missing?.length || 0;
  const smallTargets = tapTargets?.smallTargetCount || 0;
  const a11yScore = clampScore(100 - axeViolations * 5 - headingIssues * 5 - focusMissing * 2 - inputsMissingLabels * 2 - smallTargets);
  const a11yIssues = [];
  if (axeViolations) a11yIssues.push(`axe violations (${axeViolations})`);
  if (headingIssues) a11yIssues.push(`heading order issues (${headingIssues})`);
  if (focusMissing) a11yIssues.push(`focus visibility missing (${focusMissing})`);
  if (inputsMissingLabels) a11yIssues.push(`unlabeled inputs (${inputsMissingLabels})`);
  if (smallTargets) a11yIssues.push(`small tap targets (${smallTargets})`);

  const reflowOverflow = reflow?.overflowX === true;
  const responsiveScore = clampScore(100
    - (viewportMeta ? 0 : 20)
    - (reflowOverflow ? 30 : 0)
    - smallTargets * 1);
  const responsiveIssues = [];
  if (!viewportMeta) responsiveIssues.push('missing viewport meta');
  if (reflowOverflow) responsiveIssues.push('reflow overflow at 320px');
  if (smallTargets) responsiveIssues.push(`small tap targets (${smallTargets})`);

  const loadMs = perf?.load || 0;
  const dclMs = perf?.domContentLoaded || 0;
  const totalTransfer = perfSignals?.totalTransfer || 0;
  const largeImages = perfSignals?.largeImages || 0;
  const perfScore = clampScore(100
    - (loadMs > 6000 ? 20 : loadMs > 3000 ? 10 : 0)
    - (dclMs > 3000 ? 10 : 0)
    - (totalTransfer > 8_000_000 ? 20 : totalTransfer > 4_000_000 ? 10 : 0)
    - largeImages * 2);
  const perfIssues = [];
  if (loadMs > 3000) perfIssues.push(`slow load (${Math.round(loadMs)}ms)`);
  if (dclMs > 3000) perfIssues.push(`slow DOMContentLoaded (${Math.round(dclMs)}ms)`);
  if (totalTransfer > 4_000_000) perfIssues.push(`large transfer ${(totalTransfer / 1_000_000).toFixed(1)}MB`);
  if (largeImages) perfIssues.push(`large images (${largeImages})`);

  const fontCount = styles?.fontCount || 0;
  const colorCount = styles?.colorCount || 0;
  const designScore = clampScore(100
    - Math.max(0, fontCount - 3) * 5
    - Math.max(0, colorCount - 12) * 1);
  const designIssues = [];
  if (fontCount > 3) designIssues.push(`many fonts (${fontCount})`);
  if (colorCount > 12) designIssues.push(`many colors (${colorCount})`);

  const loremCount = domSignals?.loremText?.length || 0;
  const genericCtas = domSignals?.genericCtas?.length || 0;
  const contentScore = clampScore(100 - loremCount * 5 - genericCtas * 2);
  const contentIssues = [];
  if (loremCount) contentIssues.push(`placeholder copy (${loremCount})`);
  if (genericCtas) contentIssues.push(`generic CTAs (${genericCtas})`);

  const stateSignals = domSignals?.stateSignals || {};
  const stateScore = clampScore(60
    + Math.min(20, (stateSignals.loadingHints || 0) * 2)
    + Math.min(10, (stateSignals.errorHints || 0) * 2)
    + Math.min(10, (stateSignals.ariaLive || 0) * 2));
  const stateIssues = [];
  if ((stateSignals.loadingHints || 0) === 0) stateIssues.push('no loading indicators detected');
  if ((stateSignals.errorHints || 0) === 0) stateIssues.push('no error/alert indicators detected');

  const externalBlankNoRel = domSignals?.externalBlankNoRel?.length || 0;
  const trustScore = clampScore(100 - externalBlankNoRel * 2);
  const trustIssues = [];
  if (externalBlankNoRel) trustIssues.push(`external links missing rel=noopener (${externalBlankNoRel})`);

  const consoleCount = consoleIssues?.length || 0;
  const failedReqs = networkIssues?.failedRequests?.length || 0;
  const httpErrors = networkIssues?.httpErrors?.length || 0;
  const regressionScore = clampScore(100 - consoleCount * 2 - failedReqs * 2 - httpErrors * 1);
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
