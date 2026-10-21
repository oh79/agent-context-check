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

function markdownParts(text) {
  let masked = text;
  const code = [];
  // shortcut: CommonMark block nesting is not parsed; use a Markdown AST if needed.
  for (let i = 0; i < text.length; i++) {
    let stop;
    const marker = (i === 0 || text[i - 1] === '\n') && /^ {0,3}(`{3,}|~{3,})[^\n]*/.exec(text.slice(i));
    if (marker) {
      const closing = new RegExp(`^ {0,3}${marker[1][0]}{${marker[1].length},}[ \\t\\r]*$`, 'gm');
      closing.lastIndex = i + marker[0].length;
      const match = closing.exec(text);
      stop = match ? match.index + match[0].length : text.length;
      const start = i + marker[0].length;
      code.push({ text: text.slice(start, match ? match.index : text.length), start, fenced: true });
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
      if (close !== -1) {
        stop = close + delimiter.length;
        code.push({ text: text.slice(end, close), start: end, fenced: false });
      }
      else i = end - 1;
    }
    if (stop !== undefined) {
      masked = masked.slice(0, i) + blank(text.slice(i, stop)) + masked.slice(stop);
      i = stop - 1;
    }
  }
  return { visible: masked, code };
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
  let text = markdownParts(source).visible;
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

async function instructionFiles(projectRoot, files, issue, excludedDirectory) {
  if (files !== undefined && (!Array.isArray(files) || files.some(file => typeof file !== 'string'))) throw new TypeError('files must be an array of file paths');
  const sources = [];
  async function discover(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      issue(relativeName(projectRoot, directory), 1, '', 'read-error', `Cannot read directory (${error.code || 'error'})`);
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(directory, entry.name);
      if (file === excludedDirectory) continue;
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
  return sources;
}

/** Check local Markdown destinations without network requests or file writes. */
export async function checkProject({ root = process.cwd(), files } = {}) {
  const projectRoot = await realpath(path.resolve(root));
  if (!(await stat(projectRoot)).isDirectory()) throw new Error('Project root must be a directory');
  const report = { filesChecked: 0, linksChecked: 0, issues: [] };
  const issue = (file, line, target, code, message) => report.issues.push({ file, line, target, code, message });
  const sources = await instructionFiles(projectRoot, files, issue);
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
      if (!target || target === 'URL' || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
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

const skillVariable = '${CLAUDE_SKILL_DIR}/';
const dynamicReference = target => /[$*?{}<>]|(?:^|\/)\.\.\.(?:\/|$)|…/.test(target);

function packageReferences(source) {
  const references = markdownLinks(source).map(reference => ({ ...reference, kind: 'markdown' }));
  for (const part of markdownParts(source).code) {
    const trimmed = part.text.trim();
    // Option-like suffixes make an inline span an ambiguous command, not a certain path literal.
    if (!part.fenced && /^(?:\.\/)?(?:scripts|references|assets)\//.test(trimmed) && !/[\r\n]|\s-(?:\S|$)/.test(trimmed)) {
      references.push({ target: trimmed, line: source.slice(0, part.start).split('\n').length, kind: 'literal' });
    }
    for (const match of part.text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\//g)) {
      const begin = match.index;
      const quote = part.text[begin - 1];
      const rest = part.text.slice(begin + skillVariable.length);
      let tail;
      if (quote === '"' || quote === "'") {
        const close = rest.indexOf(quote);
        if (close === -1) continue;
        tail = rest.slice(0, close);
      } else tail = /^[^\s"'`;|&<>)]*/.exec(rest)[0];
      references.push({ target: skillVariable + tail, line: source.slice(0, part.start + begin).split('\n').length, kind: 'literal' });
    }
  }
  return references.sort((a, b) => a.line - b.line);
}

async function inspectTarget(root, candidate) {
  try {
    if (!contained(root, candidate) || !contained(root, await realAncestor(candidate))) return { code: 'outside-root', message: 'Destination is outside its root' };
    const info = await stat(candidate);
    return { exists: true, kind: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other' };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return { exists: false };
    return { code: 'read-error', message: `Cannot inspect destination (${error.code || 'error'})` };
  }
}

/** Compare explicit instruction references against an already-created artifact tree. */
export async function comparePackage({ source, artifact, files } = {}) {
  if (typeof source !== 'string' || !source) throw new TypeError('source directory is required');
  if (typeof artifact !== 'string' || !artifact) throw new TypeError('artifact directory is required');
  const sourceRoot = await realpath(path.resolve(source));
  const artifactRoot = await realpath(path.resolve(artifact));
  if (!(await stat(sourceRoot)).isDirectory() || !(await stat(artifactRoot)).isDirectory()) throw new Error('Source and artifact roots must be directories');
  const report = { filesChecked: 0, referencesChecked: 0, issues: [] };
  const issue = (file, line, target, code, message, states = {}) => report.issues.push({ file, line, target, code, message, ...states });
  const sources = await instructionFiles(sourceRoot, files, issue, artifactRoot !== sourceRoot ? artifactRoot : undefined);
  if (!sources.length && !report.issues.length) issue('.', 1, '', 'no-files', 'No instruction files found; provide Markdown file paths explicitly');
  for (const file of sources) {
    const name = relativeName(sourceRoot, file);
    const sourceState = await inspectTarget(sourceRoot, file);
    if (sourceState.code || !sourceState.exists || sourceState.kind !== 'file') {
      issue(name, 1, '', sourceState.code || 'read-error', sourceState.message || 'Cannot read source instruction');
      continue;
    }
    let text;
    try { text = await readFile(file, 'utf8'); }
    catch (error) { issue(name, 1, '', 'read-error', `Cannot read source instruction (${error.code || 'error'})`); continue; }
    report.filesChecked++;
    const artifactState = await inspectTarget(artifactRoot, path.resolve(artifactRoot, name));
    if (artifactState.code) issue(name, 1, name, artifactState.code, `Artifact instruction: ${artifactState.message}`, { sourceExists: true });
    else if (!artifactState.exists) issue(name, 1, name, 'missing-instruction', 'Source instruction is missing from artifact', { sourceExists: true, artifactExists: false });
    else if (artifactState.kind !== 'file') issue(name, 1, name, 'type-mismatch', 'Source instruction is a file but artifact destination is not', { sourceExists: true, artifactExists: true });
    const seen = new Set();
    for (const reference of packageReferences(text)) {
      const { target, line, kind } = reference;
      if (!target || target === 'URL' || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      const variablePath = target.startsWith(skillVariable);
      const rawPath = variablePath ? target.slice(skillVariable.length) : target;
      if (!rawPath || dynamicReference(kind === 'markdown' ? rawPath.split(/[?#]/, 1)[0] : rawPath)) continue;
      const pathname = kind === 'markdown' ? rawPath.split(/[?#]/, 1)[0] : rawPath;
      if (!pathname) continue;
      let decoded;
      try {
        decoded = kind === 'markdown' ? decodeURIComponent(pathname) : pathname;
        if (/[\x00-\x1f\x7f]/.test(decoded) || decoded.includes('\\')) throw new Error('Invalid path');
      } catch {
        report.referencesChecked++;
        issue(name, line, target, 'invalid-target', 'Local reference has invalid encoding or path characters');
        continue;
      }
      const candidate = decoded.startsWith('/') ? path.resolve(sourceRoot, `.${decoded}`) : path.resolve(path.dirname(file), decoded);
      const key = `${line}:${candidate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      report.referencesChecked++;
      const original = await inspectTarget(sourceRoot, candidate);
      if (original.code) { issue(name, line, target, original.code, `Source reference: ${original.message}`); continue; }
      const deployed = await inspectTarget(artifactRoot, path.resolve(artifactRoot, path.relative(sourceRoot, candidate)));
      const states = { sourceExists: original.exists, ...(deployed.exists !== undefined ? { artifactExists: deployed.exists } : {}) };
      if (deployed.code) issue(name, line, target, deployed.code, `Artifact reference: ${deployed.message}`, states);
      else if (!original.exists) issue(name, line, target, 'source-missing', 'Reference does not exist in source', states);
      else if (!deployed.exists) issue(name, line, target, 'artifact-missing', 'Source reference is missing from artifact', states);
      else if (original.kind !== deployed.kind) issue(name, line, target, 'type-mismatch', `Source is a ${original.kind}; artifact is a ${deployed.kind}`, states);
    }
  }
  return report;
}
