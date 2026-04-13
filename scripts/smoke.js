#!/usr/bin/env node
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const outFile = path.join(os.tmpdir(), 'uxray-ci.json');
const shotsDir = path.join(os.tmpdir(), 'uxray-shots');

const args = [
  path.join(__dirname, '..', 'ui-review.js'),
  '--url', 'https://example.com',
  '--steps', '1',
  '--wait', '800',
  '--wait-until', 'load',
  '--target-policy', 'wcag21-aaa',
  '--out', outFile,
  '--shots', shotsDir,
];

const result = spawnSync('node', args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
