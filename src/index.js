import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const instructionNames = new Set(['AGENTS.md', 'CLAUDE.md', 'SKILL.md']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'vendor']);
const blank = text => text.replace(/[^\n\r]/g, ' ');
const labelKey = text => text.trim().replace(/\s+/g, ' ').toLowerCase();
const unescapeMarkdown = text => text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
const relativeName = (root, file) => path.relative(root, file).split(path.sep).join('/') || '.';
const contained = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function visibleMarkdown(text) {
  let masked = text;
  // shortcut: CommonMark block nesting is not parsed; use a Markdown AST if needed.
  for (let i = 0; i < text.length; i++) {
    let stop;
    const marker = (i === 0 || text[i - 1] === '\n') && /^ {0,3}(`{3,}|~{3,})[^\n]*/.exec(text.slice(i));
    if (marker) {
      const closing = new RegExp(`^ {0,3}${marker[1][0]}{${marker[1].length},}[ \\t\\r]*$`, 'gm');
      closing.lastIndex = i + marker[0].length;
      const match = closing.exec(text);
      stop = match ? match.index + match[0].length : text.length;
    } else if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      stop = close === -1 ? text.length : close + 3;
    } else if (text[i] === '`' && !isEscaped(text, i)) {
      let end = i + 1;
      while (text[end] === '`') end++;
      const delimiter = text.slice(i, end);
      let close = text.indexOf(delimiter, end);
      while (close !== -1 && (text[close - 1] === '`' || text[close + delimiter.length] === '`')) {
        close = text.indexOf(delimiter, close + delimiter.length);
      }
      if (close !== -1) stop = close + delimiter.length;
      else i = end - 1;
    }
    if (stop !== undefined) {
      masked = masked.slice(0, i) + blank(text.slice(i, stop)) + masked.slice(stop);
      i = stop - 1;
    }
  }
  return masked;
}

function isEscaped(text, index) {
  let count = 0;
  while (index > 0 && text[--index] === '\\') count++;
  return count % 2 === 1;
}

function closingBracket(text, start) {
  let depth = 1;
  for (let i = start + 1; i < text.length; i++) {
    if (isEscaped(text, i)) continue;
    if (text[i] === '[') depth++;
    if (text[i] === ']' && --depth === 0) return i;
  }
  return -1;
}

function destination(text, start) {
  let cursor = start;
  while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++;
  let target;
  if (text[cursor] === '<') {
    const close = text.indexOf('>', cursor + 1);
    if (close === -1 || /[\r\n]/.test(text.slice(cursor, close))) return undefined;
    target = text.slice(cursor + 1, close);
    cursor = close + 1;
  } else {
    const begin = cursor;
    let depth = 0;
    while (cursor < text.length) {
      if (isEscaped(text, cursor)) { cursor++; continue; }
      const char = text[cursor];
      if (char === '(') depth++;
      if (char === ')') {
        if (depth === 0) break;
        depth--;
      }
      if (/\s/.test(char) && depth === 0) break;
      cursor++;
    }
    if (depth !== 0) return undefined;
    target = text.slice(begin, cursor);
  }
  const tail = /^\s*(?:("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\))\s*)?\)/.exec(text.slice(cursor));
  if (!tail) return undefined;
  return { target: unescapeMarkdown(target), end: cursor + tail[0].length };
}

function markdownLinks(source) {
  let text = visibleMarkdown(source);
  const definitions = new Map();
  text = text.replace(/^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]*>|(?:\\.|[^\s])+)[^\n]*$/gm, (whole, label, value) => {
    const key = labelKey(label);
    if (!definitions.has(key)) definitions.set(key, unescapeMarkdown(value.startsWith('<') ? value.slice(1, -1) : value));
    return blank(whole);
  });
  const links = [];
  for (let cursor = 0; cursor < text.length; cursor++) {
    if (text[cursor] !== '[' || isEscaped(text, cursor)) continue;
    const close = closingBracket(text, cursor);
    if (close === -1) continue;
    const label = text.slice(cursor + 1, close);
    let link;
    if (text[close + 1] === '(') link = destination(text, close + 2);
    else if (text[close + 1] === '[') {
      const referenceEnd = closingBracket(text, close + 1);
      if (referenceEnd !== -1) {
        const target = definitions.get(labelKey(text.slice(close + 2, referenceEnd) || label));
        if (target !== undefined) link = { target, end: referenceEnd + 1 };
      }
    } else {
      const target = definitions.get(labelKey(label));
      if (target !== undefined) link = { target, end: close + 1 };
    }
    if (!link) continue;
    links.push({ target: link.target, line: source.slice(0, cursor).split('\n').length });
    cursor = link.end - 1;
  }
  return links;
}

async function realAncestor(file) {
  try { return await realpath(file); }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return realAncestor(parent);
  }
}

/** Check local Markdown destinations without network requests or file writes. */
export async function checkProject({ root = process.cwd(), files } = {}) {
  const projectRoot = await realpath(path.resolve(root));
  if (!(await stat(projectRoot)).isDirectory()) throw new Error('Project root must be a directory');
  if (files !== undefined && (!Array.isArray(files) || files.some(file => typeof file !== 'string'))) throw new TypeError('files must be an array of file paths');
  const report = { filesChecked: 0, linksChecked: 0, issues: [] };
  const sources = [];
  const issue = (file, line, target, code, message) => report.issues.push({ file, line, target, code, message });
  async function discover(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      issue(relativeName(projectRoot, directory), 1, '', 'read-error', `Cannot read directory (${error.code || 'error'})`);
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) await discover(file);
      else if (entry.isFile() && instructionNames.has(entry.name)) sources.push(file);
    }
  }
  if (files?.length) {
    for (const input of [...new Set(files)]) {
      const file = path.resolve(projectRoot, input);
      const name = relativeName(projectRoot, file);
      try {
        if (!contained(projectRoot, file) || !contained(projectRoot, await realAncestor(file))) {
          issue(name, 1, input, 'outside-root', 'Input file is outside the project root');
        } else if (!(await stat(file)).isFile()) issue(name, 1, input, 'read-error', 'Input must be a regular file');
        else sources.push(file);
      } catch (error) { issue(name, 1, input, 'read-error', `Cannot read input (${error.code || 'error'})`); }
    }
  } else await discover(projectRoot);
  if (!sources.length && !report.issues.length) issue('.', 1, '', 'no-files', 'No instruction files found; provide Markdown file paths explicitly');
  for (const file of sources) {
    const name = relativeName(projectRoot, file);
    let source;
    try {
      if (!contained(projectRoot, await realpath(file))) {
        issue(name, 1, '', 'outside-root', 'Input file is outside the project root');
        continue;
      }
      source = await readFile(file, 'utf8');
      report.filesChecked++;
    } catch (error) { issue(name, 1, '', 'read-error', `Cannot read input (${error.code || 'error'})`); continue; }
    for (const { target, line } of markdownLinks(source)) {
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      const pathname = target.split(/[?#]/, 1)[0];
      if (!pathname) continue;
      report.linksChecked++;
      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
        if (/[\x00-\x1f\x7f]/.test(decoded) || decoded.includes('\\')) throw new Error('Invalid path');
      } catch {
        issue(name, line, target, 'invalid-target', 'Local destination has invalid encoding or path characters');
        continue;
      }
      const candidate = decoded.startsWith('/') ? path.resolve(projectRoot, `.${decoded}`) : path.resolve(path.dirname(file), decoded);
      try {
        if (!contained(projectRoot, candidate) || !contained(projectRoot, await realAncestor(candidate))) {
          issue(name, line, target, 'outside-root', 'Local destination is outside the project root');
          continue;
        }
        await stat(candidate);
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) issue(name, line, target, 'missing-target', 'Local destination does not exist');
        else issue(name, line, target, 'read-error', `Cannot inspect destination (${error.code || 'error'})`);
      }
    }
  }
  return report;
}
