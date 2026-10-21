#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { checkProject, comparePackage } from '../src/index.js';

const help = `Usage: agent-context-check [--root DIRECTORY] [--json] [FILES...]
       agent-context-check compare --source DIRECTORY --artifact DIRECTORY [--json] [FILES...]

Find broken local Markdown links in AGENTS.md, CLAUDE.md and SKILL.md.
Pass file paths to check other Markdown files. Paths are relative to --root.

  --root DIRECTORY  Project boundary (default: current directory)
  --source DIRECTORY   Source tree for comparison
  --artifact DIRECTORY Already-created artifact tree for comparison
  --json            Print a JSON report
  --help, -h        Show this help
  --version, -v     Show the version
  --                Treat the remaining arguments as file paths

Exit codes: 0 clean, 1 findings (including no files), 2 invocation errors.
No network requests. No files are modified.
`;
const safe = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

try {
  const args = process.argv.slice(2);
  const comparing = args[0] === 'compare';
  if (comparing) args.shift();
  let root = process.cwd();
  let source;
  let artifact;
  let json = false;
  let positional = false;
  let showHelp = false;
  let showVersion = false;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (positional) files.push(arg);
    else if (arg === '--') positional = true;
    else if (arg === '--root' && !comparing) {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--root requires a directory');
      root = args[++i];
    } else if ((arg === '--source' || arg === '--artifact') && comparing) {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${arg} requires a directory`);
      if (arg === '--source') source = args[++i];
      else artifact = args[++i];
    } else if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') showHelp = true;
    else if (arg === '--version' || arg === '-v') showVersion = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else files.push(arg);
  }
  if (showHelp) process.stdout.write(help);
  else if (showVersion) {
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${version}\n`);
  } else {
    const report = comparing ? await comparePackage({ source, artifact, files }) : await checkProject({ root, files });
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const issue of report.issues) {
        const target = issue.target ? ` ${safe(issue.target)}` : '';
        const states = comparing && issue.sourceExists !== undefined ? ` (source ${issue.sourceExists ? 'exists' : 'missing'}${issue.artifactExists !== undefined ? `; artifact ${issue.artifactExists ? 'exists' : 'missing'}` : ''})` : '';
        process.stdout.write(`${safe(issue.file)}:${issue.line} [${issue.code}]${target} — ${safe(issue.message)}${states}\n`);
      }
      const counted = comparing ? `${report.referencesChecked} reference(s)` : `${report.linksChecked} local link(s)`;
      process.stdout.write(`Checked ${report.filesChecked} file(s), ${counted}, ${report.issues.length} issue(s).\n`);
    }
    process.exitCode = report.issues.length ? 1 : 0;
  }
} catch (error) {
  process.stderr.write(`agent-context-check: ${safe(error.message)}\n`);
  process.exitCode = 2;
}
