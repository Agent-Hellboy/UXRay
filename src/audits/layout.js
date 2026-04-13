const { TARGET_POLICIES } = require('../config');

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

async function checkReflow(page) {
  const original = page.viewportSize && page.viewportSize();
  if (!original || !original.width || !original.height) return { width: null, overflowX: null };
  try {
    await page.setViewportSize({ width: 320, height: original.height });
    await page.waitForTimeout(200);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth > 1);
    await page.setViewportSize(original);
    return { width: 320, overflowX };
  } catch (err) {
    try {
      await page.setViewportSize(original);
    } catch (_) {
      // ignore
    }
    return { width: 320, overflowX: null };
  }
}

module.exports = {
  detectOverflow,
  detectTapTargets,
  checkReflow,
};
