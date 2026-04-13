function parseArgs(argv) {
  const args = {
    url: null,
    mobile: false,
    width: 1280,
    height: 720,
    wait: 1500,
    waitUntil: 'load',
    readySelector: null,
    steps: 4,
    out: null,
    html: null,
    screenshots: null,
    targetPolicy: 'wcag21-aaa',
    axeTags: null,
    trace: false,
    budgetA11y: null,
    budgetTap: null,
    budgetOverflow: null,
    budgetConsole: null,
    budgetHttpErrors: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const val = argv[i];
    if (val === '--url' && argv[i + 1]) {
      args.url = argv[i + 1];
      i += 1;
    } else if (!val.startsWith('--') && !args.url) {
      args.url = val;
    } else if (val === '--mobile') {
      args.mobile = true;
    } else if (val === '--viewport' && argv[i + 1]) {
      const [w, h] = argv[i + 1].split('x');
      const width = Number.parseInt(w, 10);
      const height = Number.parseInt(h, 10);
      if (Number.isFinite(width) && width > 0) args.width = width;
      if (Number.isFinite(height) && height > 0) args.height = height;
      i += 1;
    } else if (val === '--wait' && argv[i + 1]) {
      const wait = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(wait) && wait >= 0) args.wait = wait;
      i += 1;
    } else if (val === '--wait-until' && argv[i + 1]) {
      args.waitUntil = argv[i + 1];
      i += 1;
    } else if (val === '--ready-selector' && argv[i + 1]) {
      args.readySelector = argv[i + 1];
      i += 1;
    } else if (val === '--steps' && argv[i + 1]) {
      const steps = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(steps) && steps >= 1) args.steps = steps;
      i += 1;
    } else if (val === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    } else if ((val === '--shots' || val === '--screenshots') && argv[i + 1]) {
      args.screenshots = argv[i + 1];
      i += 1;
    } else if (val === '--html') {
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args.html = argv[i + 1];
        i += 1;
      } else {
        args.html = true;
      }
    } else if (val === '--target-policy' && argv[i + 1]) {
      args.targetPolicy = argv[i + 1];
      i += 1;
    } else if (val === '--axe-tags' && argv[i + 1]) {
      args.axeTags = argv[i + 1];
      i += 1;
    } else if (val === '--trace') {
      args.trace = true;
    } else if (val === '--max-a11y' && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value >= 0) args.budgetA11y = value;
      i += 1;
    } else if (val === '--max-small-targets' && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value >= 0) args.budgetTap = value;
      i += 1;
    } else if (val === '--max-overflow' && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value >= 0) args.budgetOverflow = value;
      i += 1;
    } else if (val === '--max-console' && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value >= 0) args.budgetConsole = value;
      i += 1;
    } else if (val === '--max-http-errors' && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value >= 0) args.budgetHttpErrors = value;
      i += 1;
    }
  }
  return args;
}

const usage = 'Usage: node ui-review.js --url <https://your-app> [--mobile] [--viewport 1280x720] [--out report.json] [--html [path]] [--shots ./reports] [--wait-until load|domcontentloaded|networkidle] [--ready-selector <css>] [--target-policy wcag22-aa|wcag21-aaa|lighthouse] [--axe-tags wcag21aa,wcag2aa] [--trace] [--max-a11y N] [--max-small-targets N] [--max-overflow N] [--max-console N] [--max-http-errors N]';

module.exports = {
  parseArgs,
  usage,
};
