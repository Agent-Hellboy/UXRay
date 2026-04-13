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
      const inputType = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(inputType)) return;
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
      const hasSubmit = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
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
      .filter((el) => el.isConnected)
      .filter((el) => !el.hasAttribute('disabled'))
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) === 0) return false;
        if (el.getClientRects().length === 0) return false;
        if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
        return true;
      })
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

module.exports = {
  collectDomSignals,
  checkFocusVisibility,
};
