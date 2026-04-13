const path = require('path');
const { ensureDir } = require('../utils');

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

    const didReachEnd = await page.evaluate(() => {
      const viewportHeight = window.innerHeight;
      const before = window.scrollY;
      window.scrollBy({ top: viewportHeight * 0.85, left: 0, behavior: 'instant' });
      return { before, after: window.scrollY, max: document.documentElement.scrollHeight - viewportHeight };
    });

    if (didReachEnd.after >= didReachEnd.max) break;
    await page.waitForTimeout(500);
  }

  return shotPaths.map((p) => path.relative(process.cwd(), p));
}

async function captureCrops(page, items, dir, prefix, limit = 8) {
  if (!items || !items.length) return [];
  ensureDir(dir);
  const viewport = page.viewportSize && page.viewportSize();
  const docSize = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  const crops = [];
  const targets = items.slice(0, limit);
  for (let i = 0; i < targets.length; i += 1) {
    const rect = targets[i].rect;
    if (!rect || !rect.width || !rect.height) continue;
    if (viewport) {
      const outOfView = rect.x > viewport.width || rect.y > viewport.height || rect.x + rect.width < 0 || rect.y + rect.height < 0;
      if (outOfView) continue;
    }
    const clip = {
      x: Math.max(0, rect.x - 4),
      y: Math.max(0, rect.y - 4),
      width: rect.width + 8,
      height: rect.height + 8,
    };
    const maxWidth = Math.max(0, docSize.width - clip.x);
    const maxHeight = Math.max(0, docSize.height - clip.y);
    clip.width = Math.min(clip.width, maxWidth);
    clip.height = Math.min(clip.height, maxHeight);
    if (clip.width <= 1 || clip.height <= 1) continue;
    const cropPath = path.join(dir, `${prefix}-${i + 1}.png`);
    try {
      await page.screenshot({ path: cropPath, clip });
      crops.push(path.relative(process.cwd(), cropPath));
    } catch (err) {
      console.warn(`crop failed for ${prefix} index ${i}: ${err.message}`);
    }
  }
  return crops;
}

module.exports = {
  captureScrollShots,
  captureCrops,
};
