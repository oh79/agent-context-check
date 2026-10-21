import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as core from '../src/index.js';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-context-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return root;
}
async function compare(options) {
  assert.equal(typeof core.comparePackage, 'function', 'comparison API is available');
  return core.comparePackage(options);
}
async function link(t, target, file, type) {
  try { await symlink(target, file, type); return true; }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('Host does not permit symlinks'); return false; }
    throw error;
  }
}

test('compares a complete skill package with Markdown and literal code references', async t => {
  const files = { 'SKILL.md': '[Guide](references/guide.md)\nRun `scripts/run.mjs`.\nUse `assets/logo.svg`.\n', 'references/guide.md': '', 'scripts/run.mjs': '', 'assets/logo.svg': '' };
  const source = await fixture(t, files), artifact = await fixture(t, files);
  assert.deepEqual(await compare({ source, artifact }), { filesChecked: 1, referencesChecked: 3, issues: [] });
});

test('distinguishes a source file omitted from the artifact with source line evidence', async t => {
  const text = '# Deployment\nRead [checklist](references/deploy.md).\n';
  const source = await fixture(t, { 'SKILL.md': text, 'references/deploy.md': '' });
  const artifact = await fixture(t, { 'SKILL.md': text });
  const result = await compare({ source, artifact });
  assert.equal(result.referencesChecked, 1);
  assert.deepEqual(result.issues.map(({ file, line, target, code, sourceExists, artifactExists }) => ({ file, line, target, code, sourceExists, artifactExists })), [
    { file: 'SKILL.md', line: 2, target: 'references/deploy.md', code: 'artifact-missing', sourceExists: true, artifactExists: false },
  ]);
});

test('reports a missing artifact instruction even when all referenced assets exist', async t => {
  const source = await fixture(t, { 'nested/SKILL.md': '`scripts/run.sh`', 'nested/scripts/run.sh': '' });
  const artifact = await fixture(t, { 'nested/scripts/run.sh': '' });
  const result = await compare({ source, artifact });
  assert.equal(result.filesChecked, 1);
  assert.deepEqual(result.issues.map(x => [x.file, x.code, x.sourceExists, x.artifactExists]), [['nested/SKILL.md', 'missing-instruction', true, false]]);
});

test('excludes an artifact directory nested inside source discovery', async t => {
  const source = await fixture(t, { 'SKILL.md': '[Guide](references/guide.md)', 'references/guide.md': '', 'package/SKILL.md': '[Guide](references/guide.md)', 'package/references/guide.md': '' });
  const result = await compare({ source, artifact: path.join(source, 'package') });
  assert.deepEqual(result, { filesChecked: 1, referencesChecked: 1, issues: [] });
});

test('does not mask a broken source reference with a file present only in artifact', async t => {
  const source = await fixture(t, { 'SKILL.md': '`assets/logo.svg`' });
  const artifact = await fixture(t, { 'SKILL.md': '', 'assets/logo.svg': '' });
  const result = await compare({ source, artifact });
  assert.deepEqual(result.issues.map(x => [x.code, x.sourceExists, x.artifactExists]), [['source-missing', false, true]]);
});

test('resolves quoted skill variables beside nested SKILL.md and reports type mismatch', async t => {
  const text = '```sh\nbash "${CLAUDE_SKILL_DIR}/scripts/check.sh"\n```\n';
  const source = await fixture(t, { 'skills/deploy/SKILL.md': text, 'skills/deploy/scripts/check.sh': '' });
  const artifact = await fixture(t, { 'skills/deploy/SKILL.md': text, 'skills/deploy/scripts/check.sh/child': '', 'scripts/check.sh': '' });
  const result = await compare({ source, artifact });
  assert.equal(result.referencesChecked, 1);
  assert.deepEqual(result.issues.map(x => [x.file, x.line, x.target, x.code, x.sourceExists, x.artifactExists]), [['skills/deploy/SKILL.md', 2, '${CLAUDE_SKILL_DIR}/scripts/check.sh', 'type-mismatch', true, true]]);
});

test('handles literal paths containing spaces and encoded Korean Markdown references', async t => {
  const text = '`references/a b.md`\n```sh\ncat "${CLAUDE_SKILL_DIR}/references/a b.md"\n```\n[한글](references/%ED%95%9C%EA%B8%80.md#heading)\n';
  const files = { 'SKILL.md': text, 'references/a b.md': '', 'references/한글.md': '' };
  const source = await fixture(t, files), artifact = await fixture(t, files);
  const result = await compare({ source, artifact });
  assert.equal(result.referencesChecked, 3);
  assert.deepEqual(result.issues, []);
});

test('skips inline command options while checking literal paths containing spaces', async t => {
  const text = 'Run `scripts/run.mjs --help` or `scripts/run.mjs -h`.\nRead `references/release notes.md`.\n';
  const source = await fixture(t, { 'SKILL.md': text, 'scripts/run.mjs': '', 'references/release notes.md': '' });
  const artifact = await fixture(t, { 'SKILL.md': text, 'scripts/run.mjs': '' });
  const result = await compare({ source, artifact });
  assert.equal(result.referencesChecked, 1);
  assert.deepEqual(result.issues.map(({ line, target, code, sourceExists, artifactExists }) => ({ line, target, code, sourceExists, artifactExists })), [
    { line: 2, target: 'references/release notes.md', code: 'artifact-missing', sourceExists: true, artifactExists: false },
  ]);
});

test('ignores placeholder, dynamic and glob examples and never executes code blocks', async t => {
  const text = '[Title](URL)\n`references/*.md` `references/<name>.md` `scripts/${variant}.sh`\n<!-- `references/hidden.md` -->\n```sh\nbash "${CLAUDE_SKILL_DIR}/scripts/${variant}.sh"\ncat "${CLAUDE_SKILL_DIR}/references/*.md"\ntouch should-never-exist\n```\n';
  const source = await fixture(t, { 'SKILL.md': text }), artifact = await fixture(t, { 'SKILL.md': text });
  const result = await compare({ source, artifact });
  assert.equal(result.referencesChecked, 0);
  assert.deepEqual(result.issues, []);
  await assert.rejects(stat(path.join(source, 'should-never-exist')), /ENOENT/);
  await assert.rejects(stat(path.join(artifact, 'should-never-exist')), /ENOENT/);
});

test('deduplicates Markdown and literal code destinations on the same line', async t => {
  const files = { 'SKILL.md': '[Guide](references/a.md) and `references/a.md`', 'references/a.md': '' };
  const source = await fixture(t, files), artifact = await fixture(t, files);
  const result = await compare({ source, artifact });
  assert.equal(result.referencesChecked, 1);
  assert.deepEqual(result.issues, []);
});

test('rejects Markdown path traversal in source', async t => {
  const source = await fixture(t, { 'SKILL.md': '[Escape](../secret.md)' }), artifact = await fixture(t, { 'SKILL.md': '' });
  const result = await compare({ source, artifact });
  assert.equal(result.issues[0].code, 'outside-root');
});

test('rejects a missing artifact leaf below an escaping symlink ancestor', async t => {
  const text = '`scripts/check.sh`';
  const source = await fixture(t, { 'SKILL.md': text, 'scripts/check.sh': '' }), artifact = await fixture(t, { 'SKILL.md': text });
  const outside = await fixture(t, {});
  if (!(await link(t, outside, path.join(artifact, 'scripts'), 'dir'))) return;
  const result = await compare({ source, artifact });
  assert.equal(result.issues[0].code, 'outside-root');
});

test('rejects a source symlink target outside the root', async t => {
  const text = '`references/check.md`';
  const source = await fixture(t, { 'SKILL.md': text }), artifact = await fixture(t, { 'SKILL.md': text });
  const outside = await fixture(t, { 'check.md': '' });
  if (!(await link(t, outside, path.join(source, 'references'), 'dir'))) return;
  const result = await compare({ source, artifact });
  assert.equal(result.issues[0].code, 'outside-root');
});

test('rejects an artifact instruction symlink outside the root', async t => {
  const source = await fixture(t, { 'SKILL.md': '' }), artifact = await fixture(t, {}), outside = await fixture(t, { 'SKILL.md': 'private' });
  if (!(await link(t, path.join(outside, 'SKILL.md'), path.join(artifact, 'SKILL.md')))) return;
  const result = await compare({ source, artifact });
  assert.equal(result.issues[0].code, 'outside-root');
});

test('reports malformed encodings and explicit missing input files', async t => {
  const source = await fixture(t, { 'SKILL.md': '[Bad](references/bad%ZZ.md)' }), artifact = await fixture(t, { 'SKILL.md': '' });
  const result = await compare({ source, artifact, files: ['SKILL.md', 'absent.md'] });
  assert.deepEqual(result.issues.map(x => x.code), ['read-error', 'invalid-target']);
});

test('requires both valid directory roots and rejects an empty scan', async t => {
  const source = await fixture(t, {}), artifact = await fixture(t, {});
  assert.equal((await compare({ source, artifact })).issues[0].code, 'no-files');
  await assert.rejects(compare({ source }), /artifact/i);
  await assert.rejects(compare({ source, artifact: path.join(artifact, 'missing') }), /ENOENT/);
  await writeFile(path.join(source, 'file.md'), '');
  await assert.rejects(compare({ source: path.join(source, 'file.md'), artifact }), /director/i);
});
