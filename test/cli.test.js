import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
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

async function pluginFixture(t, { damaged = false } = {}) {
  const source = await fixture(t), artifact = await fixture(t);
  for (const root of [source, artifact]) {
    await mkdir(path.join(root, 'skills/deploy'), { recursive: true });
    await mkdir(path.join(root, 'scripts'));
    await writeFile(path.join(root, 'skills/deploy/SKILL.md'), '# Deploy\n`"${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs"`\n');
  }
  await writeFile(path.join(source, 'scripts/gate.mjs'), '');
  if (!damaged) await writeFile(path.join(artifact, 'scripts/gate.mjs'), '');
  return { source, artifact };
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

test('compare CLI reports a missing artifact reference with JSON and exit 1', async t => {
  const source = await fixture(t, '[Build](scripts/build.sh)'), artifact = await fixture(t, '[Build](scripts/build.sh)');
  await mkdir(path.join(source, 'scripts'));
  await writeFile(path.join(source, 'scripts/build.sh'), '');
  const result = run('compare', '--source', source, '--artifact', artifact, '--json');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.referencesChecked, 1);
  assert.equal(report.issues[0].code, 'artifact-missing');
  assert.equal(report.issues[0].sourceExists, true);
  assert.equal(report.issues[0].artifactExists, false);
});

test('compare CLI exits cleanly for a complete explicit package and describes the comparison', async t => {
  const source = await fixture(t, ''), artifact = await fixture(t, '');
  const result = run('compare', '--source', source, '--artifact', artifact, 'AGENTS.md');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 file.*0 reference.*0 issue/);
});

test('compare CLI rejects missing roots and mode-inappropriate options', async t => {
  const source = await fixture(t, '');
  for (const args of [[], ['--source', source], ['--artifact', source], ['--source'], ['--source', source, '--artifact', '/this/path/does/not/exist'], ['--root', source]]) {
    const result = run('compare', ...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.ok(result.stderr.length > 0);
  }
});

test('compare help describes source and artifact without requiring input roots', () => {
  const result = run('compare', '--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--source/);
  assert.match(result.stdout, /--artifact/);
  assert.match(result.stdout, /--plugin-root/);
});

test('compare CLI fails unresolved plugin references without claiming absent files', async t => {
  const { source, artifact } = await pluginFixture(t);
  const result = run('compare', '--source', source, '--artifact', artifact, '--json');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.referencesChecked, 1);
  assert.equal(report.issues[0].code, 'unresolved-variable');
  assert.equal(report.issues[0].file, 'skills/deploy/SKILL.md');
  assert.equal(report.issues[0].line, 2);
  assert.equal(Object.hasOwn(report.issues[0], 'sourceExists'), false);
  assert.equal(Object.hasOwn(report.issues[0], 'artifactExists'), false);
});

test('compare CLI passes an explicit plugin root into the comparison', async t => {
  const { source, artifact } = await pluginFixture(t);
  const result = run('compare', '--source', source, '--artifact', artifact, '--plugin-root', '.', '--json');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.referencesChecked, 1);
  assert.deepEqual(report.issues, []);
});

test('compare CLI reports a missing script inside a declared plugin root', async t => {
  const { source, artifact } = await pluginFixture(t, { damaged: true });
  const result = run('compare', '--source', source, '--artifact', artifact, '--plugin-root', '.', '--json');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const issue = JSON.parse(result.stdout).issues[0];
  assert.equal(issue.code, 'artifact-missing');
  assert.equal(issue.sourceExists, true);
  assert.equal(issue.artifactExists, false);
});

test('CLI rejects missing or mode-inappropriate plugin root values', async t => {
  const source = await fixture(t, '');
  for (const value of [[], ['--json']]) {
    const result = run('compare', '--source', source, '--artifact', source, '--plugin-root', ...value);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--plugin-root requires a directory/);
  }
  const result = run('--root', source, '--plugin-root', '.');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option: --plugin-root/);
});
