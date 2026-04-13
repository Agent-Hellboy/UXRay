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
      const rawBg = parseRgb(style.backgroundColor);
      const font = style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();

      if (fgHex) colorCounts.set(fgHex, (colorCounts.get(fgHex) || 0) + 1);
      if (bgHex && (!rawBg || rawBg.a !== 0)) colorCounts.set(bgHex, (colorCounts.get(bgHex) || 0) + 1);
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
        contrastRisks.push({
          selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`,
          ratio: Number(ratio.toFixed(2)),
          sampleText: el.textContent.trim().slice(0, 60),
        });
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

module.exports = {
  sampleStyles,
};
