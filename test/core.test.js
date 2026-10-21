import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkProject } from '../src/index.js';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-context-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return root;
}

async function link(t, target, file, type = 'file') {
  try { await symlink(target, file, type); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('This Windows host does not grant symlink creation permission');
      return false;
    }
    throw error;
  }
  return true;
}

test('reports a missing link with the source line and checks valid links', async (t) => {
  const root = await fixture(t, { 'AGENTS.md': '# Guide\n[Good](docs/good.md)\n[Bad](docs/lost.md)\n', 'docs/good.md': '# OK' });
  const result = await checkProject({ root });
  assert.equal(result.filesChecked, 1);
  assert.equal(result.linksChecked, 2);
  assert.deepEqual(result.issues.map(({ file, line, target, code }) => ({ file, line, target, code })), [
    { file: 'AGENTS.md', line: 3, target: 'docs/lost.md', code: 'missing-target' },
  ]);
});

test('discovers nested instructions while ignoring dependencies and symlinks', async (t) => {
  const root = await fixture(t, {
    'AGENTS.md': '[Nested](docs/)', 'docs/SKILL.md': '[Guide](../AGENTS.md)',
    'node_modules/CLAUDE.md': '[Bad](no.md)', 'build/AGENTS.md': '[Bad](no.md)',
    '.git/AGENTS.md': '[Bad](no.md)', 'README.md': '[Bad](no.md)',
  });
  if (!(await link(t, path.join(root, 'docs'), path.join(root, 'alias'), 'dir'))) return;
  if (!(await link(t, path.join(root, 'AGENTS.md'), path.join(root, 'CLAUDE.md')))) return;
  const result = await checkProject({ root });
  assert.equal(result.filesChecked, 2);
  assert.equal(result.linksChecked, 2);
  assert.deepEqual(result.issues, []);
});

test('handles encoded Korean paths, titles, angle paths, query and root relative paths', async (t) => {
  const root = await fixture(t, {
    'nested/AGENTS.md': '[한글](../docs/%ED%95%9C%EA%B8%80.md#title)\n[Space](<../docs/a b.md> "A title")\n[Root](/docs/a%20b.md?raw=1)\n[Paren](../docs/a(b).md)\n[Escaped](../docs/a\\(b\\).md)\n[Title](../docs/한글.md "`title`")\n',
    'docs/한글.md': '', 'docs/a b.md': '', 'docs/a(b).md': '',
  });
  const result = await checkProject({ root });
  assert.equal(result.linksChecked, 6);
  assert.deepEqual(result.issues, []);
});

test('checks full, collapsed and shortcut reference links', async (t) => {
  const root = await fixture(t, {
    'AGENTS.md': '[Visible][Guide]\n[guide][]\n[GUIDE]\n[Missing][lost]\n\n[guide]: docs/good.md "Guide"\n[lost]: docs/no.md\n',
    'docs/good.md': '',
  });
  const result = await checkProject({ root });
  assert.equal(result.linksChecked, 4);
  assert.deepEqual(result.issues.map(x => [x.line, x.target]), [[4, 'docs/no.md']]);
});

test('skips external links, anchors, code fences, inline code and HTML comments', async (t) => {
  const root = await fixture(t, {
    'AGENTS.md': '[Web](https://example.com) [Mail](mailto:x@example.com) [CDN](//example.com/a) [Self](#a)\n`[Code](no.md)`\n```md\n[Code](no.md)\n```\n~~~\n[Code](no.md)\n~~~\n<!--\n[Comment](no.md)\n-->\n[Real](missing.md)\n',
  });
  const result = await checkProject({ root });
  assert.equal(result.linksChecked, 1);
  assert.deepEqual(result.issues.map(x => [x.line, x.code]), [[12, 'missing-target']]);
});

test('checks local Markdown images', async (t) => {
  const root = await fixture(t, { 'CLAUDE.md': '![Demo](assets/demo.png)\n' });
  const result = await checkProject({ root });
  assert.equal(result.linksChecked, 1);
  assert.equal(result.issues[0].target, 'assets/demo.png');
});

test('skips the explicit URL placeholder while checking ordinary local names', async t => {
  const root = await fixture(t, { 'AGENTS.md': '> [Title](URL)\n[Real](MISSING)\n' });
  const result = await checkProject({ root });
  assert.equal(result.linksChecked, 1);
  assert.equal(result.issues[0].target, 'MISSING');
});

test('does not treat an HTML comment marker inside inline code as a comment', async (t) => {
  const root = await fixture(t, { 'AGENTS.md': '`<!--` marks an HTML comment.\n[Build](missing.md)\n' });
  const result = await checkProject({ root });
  assert.equal(result.linksChecked, 1);
  assert.deepEqual(result.issues.map(x => [x.line, x.code]), [[2, 'missing-target']]);
});

test('does not treat an HTML comment marker inside a code fence as a comment', async (t) => {
  const root = await fixture(t, { 'AGENTS.md': '```md\n<!--\n```\n[Build](missing.md)\n' });
  const result = await checkProject({ root });
  assert.equal(result.linksChecked, 1);
  assert.deepEqual(result.issues.map(x => [x.line, x.code]), [[4, 'missing-target']]);
});

test('ignores fence and inline code delimiters inside actual HTML comments', async (t) => {
  const root = await fixture(t, { 'AGENTS.md': '<!--\n```md\n`text\n[Hidden](hidden.md)\n-->\n[Build](missing.md)\n' });
  const result = await checkProject({ root });
  assert.equal(result.linksChecked, 1);
  assert.deepEqual(result.issues.map(x => [x.line, x.code]), [[6, 'missing-target']]);
});

test('rejects path traversal and targets symlinked outside the project', async (t) => {
  const root = await fixture(t, { 'AGENTS.md': '[Outside](../outside.md)\n[Symlink](escape/secret.md)\n' });
  const outside = await fixture(t, { 'secret.md': 'private' });
  if (!(await link(t, outside, path.join(root, 'escape'), 'dir'))) return;
  const result = await checkProject({ root });
  assert.deepEqual(result.issues.map(x => x.code), ['outside-root', 'outside-root']);
});

test('reports invalid URI escapes without crashing', async (t) => {
  const root = await fixture(t, { 'AGENTS.md': '[Bad](bad%ZZ.md)\n[Null](bad%00.md)' });
  const result = await checkProject({ root });
  assert.deepEqual(result.issues.map(x => x.code), ['invalid-target', 'invalid-target']);
});

test('accepts explicit Markdown inputs and reports nonexistent inputs or directories', async (t) => {
  const root = await fixture(t, { 'README.md': '[Gone](gone.md)', 'docs/a.md': '' });
  const result = await checkProject({ root, files: ['README.md', 'missing.md', 'docs'] });
  assert.equal(result.filesChecked, 1);
  assert.deepEqual(result.issues.map(x => x.code), ['read-error', 'read-error', 'missing-target']);
});

test('refuses explicit source files outside the project including symlinks', async (t) => {
  const root = await fixture(t, { 'AGENTS.md': '' });
  const outside = await fixture(t, { 'outside.md': '[Bad](secret.md)' });
  if (!(await link(t, path.join(outside, 'outside.md'), path.join(root, 'source.md')))) return;
  const result = await checkProject({ root, files: ['../outside.md', 'source.md'] });
  assert.equal(result.filesChecked, 0);
  assert.deepEqual(result.issues.map(x => x.code), ['outside-root', 'outside-root']);
});

test('reports an empty discovery and rejects nonexistent roots', async (t) => {
  const root = await fixture(t, { 'README.md': '' });
  assert.equal((await checkProject({ root })).issues[0].code, 'no-files');
  await assert.rejects(() => checkProject({ root: path.join(root, 'nope') }), /ENOENT/);
});
