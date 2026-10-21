import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/agent-context-check.js', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
async function fixture(t, text) {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-context-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (text !== undefined) await writeFile(path.join(root, 'AGENTS.md'), text);
  return root;
}

test('CLI returns a machine-readable report and exit 1 for broken links', async (t) => {
  const root = await fixture(t, '[Missing](lost.md)');
  const result = run('--root', root, '--json');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).issues[0].code, 'missing-target');
});

test('CLI prints a useful clean summary and supports explicit files', async (t) => {
  const root = await fixture(t, '[Guide](README.md)');
  await writeFile(path.join(root, 'README.md'), '# Fine');
  const result = run('--root', root, 'README.md');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 file.*0 local link.*0 issue/);
  assert.equal(result.stderr, '');
});

test('CLI reports no files as a finding', async (t) => {
  const root = await fixture(t);
  const result = run('--root', root, '--json');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).issues[0].code, 'no-files');
});

test('CLI distinguishes invalid usage and an invalid root with exit 2', () => {
  for (const args of [['--wat'], ['--root'], ['--root', '--json'], ['--root', '/this/path/does/not/exist']]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.ok(result.stderr.length > 0);
  }
});

test('CLI provides help and version without scanning', () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--root/);
  const version = run('--version');
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
});

test('CLI escapes terminal control characters in source paths', async (t) => {
  const root = await fixture(t);
  const file = 'bad\x1b[31m.md';
  const result = run('--root', root, file);
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes('\x1b'));
  assert.match(result.stdout, /read-error/);
});
