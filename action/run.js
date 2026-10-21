import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import * as scanner from '../src/index.js';

const escapeData = value => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = value => escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

try {
  const mode = process.env.INPUT_MODE || 'compare';
  if (!['check', 'compare'].includes(mode)) throw new Error('mode must be compare or check');
  if (mode === 'compare' && !process.env.INPUT_ARTIFACT) throw new Error('artifact is required in compare mode');
  const pluginRoot = process.env['INPUT_PLUGIN-ROOT'] || undefined;
  if (mode === 'check' && pluginRoot !== undefined) throw new Error('plugin-root is supported only in compare mode');
  const workspace = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  const source = path.resolve(workspace, process.env.INPUT_SOURCE || '.');
  const files = (process.env.INPUT_FILES || '').split(/\r?\n/).map(file => file.trim()).filter(Boolean);
  const report = mode === 'compare'
    ? await scanner.comparePackage({ source, artifact: path.resolve(workspace, process.env.INPUT_ARTIFACT), files, pluginRoot })
    : await scanner.checkProject({ root: source, files });
  const references = report.referencesChecked ?? report.linksChecked;
  for (const issue of report.issues) {
    const file = path.relative(workspace, path.resolve(source, issue.file)).split(path.sep).join('/');
    const line = Number.isSafeInteger(issue.line) && issue.line > 0 ? issue.line : 1;
    const message = `[${issue.code}] ${issue.message}${issue.target ? `: ${issue.target}` : ''}`;
    process.stdout.write(`::error file=${escapeProperty(file)},line=${line}::${escapeData(message)}\n`);
  }
  process.stdout.write(`Checked ${report.filesChecked} file(s), ${references} reference(s), ${report.issues.length} issue(s).\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `issues-count=${report.issues.length}\nfiles-checked=${report.filesChecked}\nreferences-checked=${references}\n`);
  }
  process.exitCode = report.issues.length ? 1 : 0;
} catch (error) {
  process.stdout.write(`::error::${escapeData(error.message)}\n`);
  process.exitCode = 2;
}
