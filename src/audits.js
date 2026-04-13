const path = require('path');
const { AxeBuilder } = require('@axe-core/playwright');
const { TARGET_POLICIES } = require('./config');
const { ensureDir } = require('./utils');

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
      const parts = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!parts) return null;
      return `#${[1, 2, 3]
        .map((i) => Number(parts[i]).toString(16).padStart(2, '0'))
        .join('')}`;
    };

    const parseRgb = (rgb) => {
      const parts = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/i);
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

    elements.forEach((el) => {
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
          ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
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

    return {
      topColors,
      topFonts,
      contrastRisks,
      colorCount: colorCounts.size,
      fontCount: fontCounts.size,
    };
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

async function collectDomSignals(page) {
  return page.evaluate(async () => {
    const format = (el) => {
      const cls = typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
    };

    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return false;
      if (rect.bottom < 0 || rect.right < 0) return false;
      if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
      return true;
    };

    const textClips = [];
    const missingImages = [];
    const coveredElements = [];
    const deadLinks = [];
    const buttonsNoText = [];
    const inputsMissingLabels = [];
    const formsWithoutSubmit = [];
    const genericCtas = [];
    const loremText = [];
    const externalBlankNoRel = [];
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const headingOrderIssues = [];

    const stateSignals = {
      ariaLive: 0,
      roleAlert: 0,
      ariaBusy: 0,
      loadingHints: 0,
      errorHints: 0,
      emptyHints: 0,
    };

    const textClipCandidates = Array.from(document.querySelectorAll('body *')).slice(0, 500);
    textClipCandidates.forEach((el) => {
      if (!el.textContent || !el.textContent.trim()) return;
      const style = getComputedStyle(el);
      if (!['hidden', 'clip'].includes(style.overflow) && !['hidden', 'clip'].includes(style.overflowX) && !['hidden', 'clip'].includes(style.overflowY)) return;
      if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
        if (textClips.length < 20) textClips.push({ selector: format(el) });
      }
    });

    const imgs = Array.from(document.querySelectorAll('img')).slice(0, 200);
    imgs.forEach((img) => {
      const inView = visible(img);
      const loading = (img.getAttribute('loading') || '').toLowerCase();
      const isLazy = loading === 'lazy' || img.loading === 'lazy';
      const hasLazyData = Boolean(img.getAttribute('data-src') || img.getAttribute('data-srcset') || img.getAttribute('data-lazy'));
      if (!inView && (isLazy || hasLazyData)) return;
      if (img.complete && img.naturalWidth === 0) {
        if (missingImages.length < 20) missingImages.push({ selector: format(img), src: img.currentSrc || img.src });
      }
    });

    const candidates = Array.from(document.querySelectorAll('body *')).filter(visible).slice(0, 120);
    candidates.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      if (!topEl || topEl === el || el.contains(topEl)) return;
      if (coveredElements.length < 20) coveredElements.push({ selector: format(el), coveredBy: format(topEl) });
    });

    const links = Array.from(document.querySelectorAll('a')).slice(0, 300);
    links.forEach((a) => {
      const href = (a.getAttribute('href') || '').trim();
      const hasDeadHref = !href || href === '#' || href.toLowerCase().startsWith('javascript:');
      const role = (a.getAttribute('role') || '').toLowerCase();
      const hasRoleAction = ['button', 'tab', 'menuitem', 'switch', 'option'].includes(role);
      const hasHandlers = Boolean(
        a.getAttribute('onclick')
        || a.getAttribute('onmousedown')
        || a.getAttribute('onmouseup')
        || a.getAttribute('onkeydown')
        || a.getAttribute('onkeyup')
        || a.getAttribute('onkeypress'),
      );
      const hasAriaAction = Boolean(
        a.getAttribute('aria-controls')
        || a.getAttribute('aria-expanded')
        || a.getAttribute('aria-haspopup'),
      );
      const hasDataAction = a.dataset && Object.keys(a.dataset).length > 0;
      const likelyJsAction = hasRoleAction || hasHandlers || hasAriaAction || hasDataAction;
      if (hasDeadHref && !likelyJsAction && deadLinks.length < 20) deadLinks.push({ selector: format(a), href });
      if (a.target === '_blank') {
        const rel = (a.getAttribute('rel') || '').toLowerCase();
        if (!rel.includes('noopener') && externalBlankNoRel.length < 20) {
          externalBlankNoRel.push({ selector: format(a), href: a.href });
        }
      }
    });

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, 200);
    buttons.forEach((btn) => {
      const text = (btn.innerText || '').trim();
      const aria = btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby');
      if (!text && !aria && buttonsNoText.length < 20) {
        buttonsNoText.push({ selector: format(btn) });
      }
      if (/^(click here|submit|go|next|ok)$/i.test(text) && genericCtas.length < 20) {
        genericCtas.push({ selector: format(btn), text });
      }
    });

    const inputs = Array.from(document.querySelectorAll('input, select, textarea')).slice(0, 300);
    inputs.forEach((el) => {
      if (el.type === 'hidden') return;
      const hasLabel = (el.labels && el.labels.length > 0)
        || el.getAttribute('aria-label')
        || el.getAttribute('aria-labelledby');
      if (!hasLabel && inputsMissingLabels.length < 30) {
        inputsMissingLabels.push({ selector: format(el), name: el.getAttribute('name') || '' });
      }
      const placeholder = (el.getAttribute('placeholder') || '').trim();
      if (/lorem ipsum|dolor sit|consectetur/i.test(placeholder) && loremText.length < 20) {
        loremText.push({ selector: format(el), text: placeholder });
      }
    });

    const forms = Array.from(document.querySelectorAll('form')).slice(0, 80);
    forms.forEach((form) => {
      const hasSubmit = form.querySelector('button[type="submit"], input[type="submit"], [role="button"]');
      if (!hasSubmit && formsWithoutSubmit.length < 20) formsWithoutSubmit.push({ selector: format(form) });
    });

    const allText = Array.from(document.querySelectorAll('body *')).slice(0, 500);
    allText.forEach((el) => {
      const text = (el.textContent || '').trim();
      if (!text) return;
      if (/lorem ipsum|dolor sit|consectetur/i.test(text) && loremText.length < 20) {
        loremText.push({ selector: format(el), text: text.slice(0, 80) });
      }
    });

    headings.forEach((h, idx) => {
      const level = Number(h.tagName.slice(1));
      const prev = headings[idx - 1];
      if (prev) {
        const prevLevel = Number(prev.tagName.slice(1));
        if (level - prevLevel > 1 && headingOrderIssues.length < 20) {
          headingOrderIssues.push({ selector: format(h), from: prev.tagName.toLowerCase(), to: h.tagName.toLowerCase() });
        }
      }
    });
    if (headings.length && headings[0].tagName.toLowerCase() !== 'h1') {
      headingOrderIssues.unshift({ selector: format(headings[0]), from: 'none', to: headings[0].tagName.toLowerCase() });
    }

    const ariaLive = document.querySelectorAll('[aria-live]').length;
    const roleAlert = document.querySelectorAll('[role="alert"]').length;
    const ariaBusy = document.querySelectorAll('[aria-busy="true"]').length;
    stateSignals.ariaLive = ariaLive;
    stateSignals.roleAlert = roleAlert;
    stateSignals.ariaBusy = ariaBusy;

    const classHints = (name) => document.querySelectorAll(`[class*="${name}"]`).length;
    stateSignals.loadingHints = classHints('loading') + classHints('spinner') + classHints('skeleton');
    stateSignals.errorHints = classHints('error') + classHints('alert');
    stateSignals.emptyHints = classHints('empty');

    return {
      textClips,
      missingImages,
      coveredElements,
      deadLinks,
      buttonsNoText,
      inputsMissingLabels,
      formsWithoutSubmit,
      genericCtas,
      loremText,
      externalBlankNoRel,
      headingOrderIssues,
      stateSignals,
    };
  });
}

async function checkFocusVisibility(page, limit = 20) {
  return page.evaluate(async (maxCount) => {
    const format = (el) => {
      const cls = typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
    };
    const focusables = Array.from(document.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.hasAttribute('disabled'))
      .slice(0, maxCount);
    const missing = [];
    let visibleCount = 0;
    for (const el of focusables) {
      el.focus();
      await new Promise((r) => requestAnimationFrame(r));
      const style = getComputedStyle(el);
      const hasOutline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      const hasBoxShadow = style.boxShadow && style.boxShadow !== 'none';
      if (hasOutline || hasBoxShadow) visibleCount += 1;
      if (!hasOutline && !hasBoxShadow && missing.length < 10) {
        missing.push({ selector: format(el) });
      }
    }
    return { total: focusables.length, visibleCount, missing };
  }, limit);
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

module.exports = {
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
};
