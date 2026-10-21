#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { checkProject } from '../src/index.js';

const help = `Usage: agent-context-check [--root DIRECTORY] [--json] [FILES...]

Find broken local Markdown links in AGENTS.md, CLAUDE.md and SKILL.md.
Pass file paths to check other Markdown files. Paths are relative to --root.

  --root DIRECTORY  Project boundary (default: current directory)
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
  let root = process.cwd();
  let json = false;
  let positional = false;
  let showHelp = false;
  let showVersion = false;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (positional) files.push(arg);
    else if (arg === '--') positional = true;
    else if (arg === '--root') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--root requires a directory');
      root = args[++i];
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
    const report = await checkProject({ root, files });
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const issue of report.issues) {
        const target = issue.target ? ` ${safe(issue.target)}` : '';
        process.stdout.write(`${safe(issue.file)}:${issue.line} [${issue.code}]${target} — ${safe(issue.message)}\n`);
      }
      process.stdout.write(`Checked ${report.filesChecked} file(s), ${report.linksChecked} local link(s), ${report.issues.length} issue(s).\n`);
    }
    process.exitCode = report.issues.length ? 1 : 0;
  }
} catch (error) {
  process.stderr.write(`agent-context-check: ${safe(error.message)}\n`);
  process.exitCode = 2;
}
