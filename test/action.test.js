import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const action = fileURLToPath(new URL('../action/run.js', import.meta.url));

async function fixture(t, { damaged = false, sourceName = 'source' } = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-context-action-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, sourceName);
  const artifact = path.join(workspace, 'package');
  for (const directory of [source, artifact]) {
    await mkdir(path.join(directory, 'references'), { recursive: true });
    await writeFile(path.join(directory, 'SKILL.md'), '# Skill\n[Guide](references/guide.md)\n');
  }
  await writeFile(path.join(source, 'references/guide.md'), '# Guide\n');
  if (!damaged) await writeFile(path.join(artifact, 'references/guide.md'), '# Guide\n');
  return { workspace, source, artifact, output: path.join(workspace, 'outputs') };
}

function run(inputs, extra = {}) {
  return spawnSync(process.execPath, [action], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INPUT_MODE: 'compare',
      INPUT_SOURCE: inputs.source,
      INPUT_ARTIFACT: inputs.artifact,
      INPUT_FILES: '',
      'INPUT_PLUGIN-ROOT': '',
      GITHUB_WORKSPACE: inputs.workspace,
      GITHUB_OUTPUT: inputs.output,
      ...extra,
    },
  });
}

async function pluginFixture(t, { damaged = false } = {}) {
  const input = await fixture(t);
  for (const directory of [input.source, input.artifact]) {
    await mkdir(path.join(directory, 'scripts'));
    await writeFile(path.join(directory, 'SKILL.md'), '# Deploy\n`"${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs"`\n');
  }
  await writeFile(path.join(input.source, 'scripts/gate.mjs'), '');
  if (!damaged) await writeFile(path.join(input.artifact, 'scripts/gate.mjs'), '');
  return input;
}

test('action compares complete packages and writes integer workflow outputs', async (t) => {
  const input = await fixture(t);
  const result = run(input);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /1 file\(s\).*1 reference\(s\).*0 issue\(s\)/);
  assert.equal(await readFile(input.output, 'utf8'), 'issues-count=0\nfiles-checked=1\nreferences-checked=1\n');
});

test('action returns failure and a source-line annotation for a missing artifact reference', async (t) => {
  const input = await fixture(t, { damaged: true });
  const result = run(input);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /::error file=source\/SKILL\.md,line=2::/);
  assert.match(result.stdout, /artifact-missing.*references\/guide\.md/);
  assert.equal(await readFile(input.output, 'utf8'), 'issues-count=1\nfiles-checked=1\nreferences-checked=1\n');
});

test('action supports check mode and workspace-relative source paths', async (t) => {
  const input = await fixture(t);
  const result = run(input, { INPUT_MODE: 'check', INPUT_SOURCE: 'source', INPUT_ARTIFACT: '', INPUT_FILES: 'SKILL.md\n' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(await readFile(input.output, 'utf8'), /references-checked=1\n/);
});

test('action rejects unknown modes, missing artifact inputs and invalid roots', async (t) => {
  const input = await fixture(t);
  for (const [extra, message] of [
    [{ INPUT_MODE: 'execute' }, /mode must be compare or check/],
    [{ INPUT_ARTIFACT: '' }, /artifact is required/],
    [{ INPUT_SOURCE: path.join(input.workspace, 'absent') }, /ENOENT|does not exist|directory/i],
  ]) {
    const result = run(input, extra);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout, /^::error::/);
    assert.match(result.stdout, message);
  }
});

test('action escapes annotation property punctuation and encoded command-like targets', async (t) => {
  const input = await fixture(t, { sourceName: 'source,100%' });
  for (const directory of [input.source, input.artifact]) {
    await writeFile(path.join(directory, 'SKILL.md'), '[Bad](references/bad%0A::warning::oops.md)\n');
  }
  const result = run(input);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /::error file=source%2C100%25\/SKILL\.md,line=1::/);
  assert.match(result.stdout, /bad%250A::warning::oops\.md/);
  assert.doesNotMatch(result.stdout, /\n::warning::/);
});

test('action fails unresolved plugin references with line evidence and real counts', async t => {
  const input = await pluginFixture(t);
  const result = run(input);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /::error file=source\/SKILL\.md,line=2::\[unresolved-variable\]/);
  assert.equal(await readFile(input.output, 'utf8'), 'issues-count=1\nfiles-checked=1\nreferences-checked=1\n');
});

test('action resolves plugin references using its plugin-root input', async t => {
  const input = await pluginFixture(t);
  const result = run(input, { 'INPUT_PLUGIN-ROOT': '.' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(await readFile(input.output, 'utf8'), 'issues-count=0\nfiles-checked=1\nreferences-checked=1\n');
});

test('action reports missing scripts under an explicit plugin root', async t => {
  const input = await pluginFixture(t, { damaged: true });
  const result = run(input, { 'INPUT_PLUGIN-ROOT': '.' });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /artifact-missing.*CLAUDE_PLUGIN_ROOT/);
  assert.equal(await readFile(input.output, 'utf8'), 'issues-count=1\nfiles-checked=1\nreferences-checked=1\n');
});

test('action rejects plugin-root in check mode as invalid configuration', async t => {
  const input = await fixture(t);
  const result = run(input, { INPUT_MODE: 'check', 'INPUT_PLUGIN-ROOT': '.' });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stdout, /plugin-root.*compare/);
  await assert.rejects(readFile(input.output), { code: 'ENOENT' });
});
