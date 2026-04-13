async function collectNavigationPerf(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    if (!nav) return null;
    return {
      domContentLoaded: nav.domContentLoadedEventEnd,
      load: nav.loadEventEnd,
      renderBlocking: nav.responseEnd,
    };
  });
}

async function collectPerfSignals(page) {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType('resource');
    const paints = performance.getEntriesByType('paint');
    const toNum = (v) => (Number.isFinite(v) ? v : 0);
    let totalTransfer = 0;
    let totalEncoded = 0;
    let imgBytes = 0;
    let jsBytes = 0;
    let cssBytes = 0;
    let largeImages = 0;
    let largeScripts = 0;
    resources.forEach((r) => {
      totalTransfer += toNum(r.transferSize);
      totalEncoded += toNum(r.encodedBodySize);
      if (r.initiatorType === 'img') {
        imgBytes += toNum(r.transferSize);
        if (toNum(r.transferSize) > 1_000_000) largeImages += 1;
      }
      if (r.initiatorType === 'script') {
        jsBytes += toNum(r.transferSize);
        if (toNum(r.transferSize) > 500_000) largeScripts += 1;
      }
      if (r.initiatorType === 'link' || r.initiatorType === 'css') {
        cssBytes += toNum(r.transferSize);
      }
    });
    const paintMap = {};
    paints.forEach((p) => { paintMap[p.name] = p.startTime; });
    return {
      resourceCount: resources.length,
      totalTransfer,
      totalEncoded,
      imgBytes,
      jsBytes,
      cssBytes,
      largeImages,
      largeScripts,
      paint: paintMap,
    };
  });
}

module.exports = {
  collectNavigationPerf,
  collectPerfSignals,
};
