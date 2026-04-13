const TARGET_POLICIES = {
  'wcag22-aa': { id: 'wcag22-aa', label: 'WCAG 2.2 AA Target Size Minimum', minSize: 24, spacing: 8 },
  'wcag21-aaa': { id: 'wcag21-aaa', label: 'WCAG 2.1 AAA Target Size', minSize: 44, spacing: 0 },
  lighthouse: { id: 'lighthouse', label: 'Lighthouse recommended tap target size', minSize: 48, spacing: 0 },
};

const WAIT_UNTIL_OPTIONS = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);

module.exports = {
  TARGET_POLICIES,
  WAIT_UNTIL_OPTIONS,
};
