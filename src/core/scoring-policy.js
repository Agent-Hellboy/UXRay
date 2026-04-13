const DEFAULT_POLICY = {
  visual: {
    overflowPenalty: 2,
    clippedPenalty: 2,
    overlapPenalty: 1,
    missingImagePenalty: 5,
    contrastPenalty: 1,
  },
  functional: {
    deadLinkPenalty: 2,
    buttonsNoTextPenalty: 2,
    inputsMissingLabelsPenalty: 2,
    formsWithoutSubmitPenalty: 5,
  },
  accessibility: {
    axePenalty: 5,
    headingPenalty: 5,
    focusPenalty: 2,
    unlabeledInputPenalty: 2,
    smallTargetPenalty: 1,
  },
  responsive: {
    missingViewportPenalty: 20,
    reflowPenalty: 30,
    smallTargetPenalty: 1,
  },
  performance: {
    loadWarnMs: 3000,
    loadBadMs: 6000,
    loadWarnPenalty: 10,
    loadBadPenalty: 20,
    dclWarnMs: 3000,
    dclWarnPenalty: 10,
    transferWarnBytes: 4_000_000,
    transferBadBytes: 8_000_000,
    transferWarnPenalty: 10,
    transferBadPenalty: 20,
    largeImagePenalty: 2,
  },
  designConsistency: {
    maxFonts: 3,
    fontPenalty: 5,
    maxColors: 12,
    colorPenalty: 1,
  },
  contentQuality: {
    loremPenalty: 5,
    genericCtaPenalty: 2,
  },
  stateCoverage: {
    baseScore: 60,
    loadingWeight: 2,
    errorWeight: 2,
    ariaLiveWeight: 2,
    loadingCap: 20,
    errorCap: 10,
    ariaLiveCap: 10,
  },
  trustPolish: {
    externalBlankPenalty: 2,
  },
  regressionRisk: {
    consolePenalty: 2,
    failedRequestPenalty: 2,
    httpErrorPenalty: 1,
  },
};

module.exports = {
  DEFAULT_POLICY,
};
