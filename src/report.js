const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils');

function aggregateCounts(desktop, mobile) {
  const sum = (getter) => {
    const d = desktop ? getter(desktop) : 0;
    const m = mobile ? getter(mobile) : 0;
    return d + m;
  };

  return {
    a11yViolations: sum((r) => r.axe?.summary?.violations || 0),
    smallTargets: sum((r) => r.tapTargets?.smallTargetCount || 0),
    overflowOffenders: sum((r) => (r.overflow?.offenders || []).length),
    consoleIssues: sum((r) => (r.consoleIssues || []).length),
    httpErrors: sum((r) => (r.networkIssues?.httpErrors || []).length),
  };
}

function evaluateBudgets(counts, budgets) {
  const entries = [];
  const check = (key, label) => {
    const limit = budgets[key];
    if (limit === null || limit === undefined || Number.isNaN(limit)) return;
    const value = counts[key] || 0;
    const pass = value <= limit;
    entries.push({ key, label, value, limit, pass });
  };

  check('a11yViolations', 'Accessibility violations');
  check('smallTargets', 'Small tap targets');
  check('overflowOffenders', 'Overflow offenders');
  check('consoleIssues', 'Console issues');
  check('httpErrors', 'HTTP errors (4xx/5xx)');

  const ok = entries.every((e) => e.pass);
  return { ok, entries };
}

function generateHtml(report, outputPath) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>UXRay report - ${report.url}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111; }
    h1 { margin-bottom: 4px; }
    .meta { color: #555; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 16px 0; }
    .card { border: 1px solid #e3e3e3; border-radius: 10px; padding: 12px 14px; background: #fafafa; }
    .card h3 { margin: 0 0 6px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ececec; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
    .pass { background: #e7f7e9; color: #0a8a2a; }
    .fail { background: #fdecea; color: #b32717; }
    .list { margin: 6px 0; padding-left: 18px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
  </style>
</head>
<body>
  <h1>UXRay Report</h1>
  <div class="meta">URL: ${report.url}<br/>Run at: ${report.runAt}<br/>Config: ${report.config.viewport}, mobile: ${report.config.mobile}, waitUntil: ${report.config.waitUntil}</div>

  <div class="grid">
    <div class="card">
      <h3>Desktop</h3>
      <table>
        <tr><th>A11y violations</th><td>${report.desktop?.axe?.summary?.violations ?? '-'}</td></tr>
        <tr><th>Small targets</th><td>${report.desktop?.tapTargets?.smallTargetCount ?? '-'}</td></tr>
        <tr><th>Overflow offenders</th><td>${report.desktop?.overflow?.offenders?.length ?? '-'}</td></tr>
        <tr><th>HTTP errors</th><td>${report.desktop?.networkIssues?.httpErrors?.length ?? '-'}</td></tr>
        <tr><th>Console issues</th><td>${report.desktop?.consoleIssues?.length ?? '-'}</td></tr>
      </table>
    </div>
    ${report.mobile ? `<div class="card">
      <h3>Mobile</h3>
      <table>
        <tr><th>A11y violations</th><td>${report.mobile?.axe?.summary?.violations ?? '-'}</td></tr>
        <tr><th>Small targets</th><td>${report.mobile?.tapTargets?.smallTargetCount ?? '-'}</td></tr>
        <tr><th>Overflow offenders</th><td>${report.mobile?.overflow?.offenders?.length ?? '-'}</td></tr>
        <tr><th>HTTP errors</th><td>${report.mobile?.networkIssues?.httpErrors?.length ?? '-'}</td></tr>
        <tr><th>Console issues</th><td>${report.mobile?.consoleIssues?.length ?? '-'}</td></tr>
      </table>
    </div>` : ''}
  </div>

  <div class="card">
    <h3>Budgets</h3>
    <table>
      <tr><th>Item</th><th>Value</th><th>Limit</th><th>Status</th></tr>
      ${(report.budgets?.entries || []).map((e) => `<tr><td>${e.label}</td><td>${e.value}</td><td>${e.limit ?? '—'}</td><td><span class="badge ${e.pass ? 'pass' : 'fail'}">${e.pass ? 'pass' : 'fail'}</span></td></tr>`).join('')}
    </table>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Evidence</h3>
      <div>Desktop shots:</div>
      <ul class="list">${(report.desktop?.screenshots || []).slice(0, 4).map((p) => `<li class="mono">${p}</li>`).join('')}</ul>
      ${report.desktop?.overflow?.crops?.length ? `<div>Overflow crops:</div><ul class="list">${report.desktop.overflow.crops.map((p) => `<li class="mono">${p}</li>`).join('')}</ul>` : ''}
      ${report.desktop?.tapTargets?.crops?.length ? `<div>Tap target crops:</div><ul class="list">${report.desktop.tapTargets.crops.map((p) => `<li class="mono">${p}</li>`).join('')}</ul>` : ''}
      ${report.desktop?.trace ? `<div>Trace: <span class="mono">${report.desktop.trace}</span></div>` : ''}
    </div>
    ${report.mobile ? `<div class="card">
      <h3>Evidence (Mobile)</h3>
      <div>Shots:</div>
      <ul class="list">${(report.mobile?.screenshots || []).slice(0, 4).map((p) => `<li class="mono">${p}</li>`).join('')}</ul>
      ${report.mobile?.overflow?.crops?.length ? `<div>Overflow crops:</div><ul class="list">${report.mobile.overflow.crops.map((p) => `<li class="mono">${p}</li>`).join('')}</ul>` : ''}
      ${report.mobile?.tapTargets?.crops?.length ? `<div>Tap target crops:</div><ul class="list">${report.mobile.tapTargets.crops.map((p) => `<li class="mono">${p}</li>`).join('')}</ul>` : ''}
      ${report.mobile?.trace ? `<div>Trace: <span class="mono">${report.mobile.trace}</span></div>` : ''}
    </div>` : ''}
  </div>
</body>
</html>`;

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, html, 'utf8');
}

module.exports = {
  aggregateCounts,
  evaluateBudgets,
  generateHtml,
};
