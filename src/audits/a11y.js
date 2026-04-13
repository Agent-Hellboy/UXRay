const { AxeBuilder } = require('@axe-core/playwright');

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
  runAxe,
};
