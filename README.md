# agent-context-check

[![CI](https://github.com/oh79/agent-context-check/actions/workflows/ci.yml/badge.svg)](https://github.com/oh79/agent-context-check/actions/workflows/ci.yml)
[한국어](README.ko.md) · [MIT](LICENSE)

Catch broken local Markdown links in `AGENTS.md`, `CLAUDE.md`, and `SKILL.md` before a coding agent follows them.

Instruction files often point to a build guide, architecture decision, or another skill. Renaming one of those files can silently leave an agent with incomplete context. This tool checks that local Markdown link targets exist and stay inside the project.

**Zero dependencies. Node.js 20+. Offline. Read-only. No API key.**

## Try it

```sh
git clone https://github.com/oh79/agent-context-check.git
cd agent-context-check
node bin/agent-context-check.js --root /path/to/your/project
```

Run without a checkout, directly from the tagged GitHub package:

```sh
npm exec --yes --package=github:oh79/agent-context-check#v0.1.0 -- agent-context-check --root .
```

The npm command downloads the package; the checker itself never accesses the network. The package is distributed through GitHub; it has not been published to the npm registry.

An instruction such as `[Build guide](docs/old-build.md)` reports an issue when the file is gone. The report includes the source file, line, target, and reason. Fix the link or restore the document, then run again.

Check specific Markdown files instead of discovering instruction files:

```sh
node bin/agent-context-check.js --root /path/to/project README.md docs/setup.md
node bin/agent-context-check.js --root /path/to/project --json
```

## What gets checked

- Automatic discovery of `AGENTS.md`, `CLAUDE.md`, and `SKILL.md`, including nested folders.
- Local inline links, images, and reference links, including angle-bracket destinations and optional titles.
- Relative paths resolved from the source document; `/docs/guide.md` resolves from the project root.
- Percent-encoded names, spaces in angle-bracket paths, and Unicode filenames.
- Missing targets, invalid local targets, unreadable input, and paths or symlinks escaping the real project root.

Existing files and directories are valid targets. Missing files are reported even when they have a `#fragment` or `?query` suffix. Fragments and queries themselves are not validated.

## Deliberate limits

This is a focused Markdown link checker, not a complete CommonMark implementation or an instruction-quality evaluator.

- Bare paths and paths inside backticks are not checked. Use `[guide](docs/guide.md)` for references you want to verify.
- Code fences, inline code, and HTML comments are ignored. HTML links and MDX expressions are not parsed.
- Web URLs, other URL schemes, protocol-relative URLs, and anchor-only links are ignored. No remote availability check runs.
- Undefined reference labels cannot reliably be distinguished from ordinary bracketed prose and are ignored.
- Automatic discovery skips symlink files and directories and common generated folders: `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, and `vendor`. Explicit input paths are checked for containment after resolving symlinks.
- The check confirms filesystem existence at the time of the scan. It does not guarantee that a model reads the file, understands it, or follows it. Run only on repositories you trust; this is not a filesystem sandbox.

## Exit status

| Status | Meaning |
| --- | --- |
| `0` | Checked files have no reported issues |
| `1` | Issues found, including no discovered instruction files |
| `2` | Invalid invocation or an unusable root directory |

`--json` emits `{ filesChecked, linksChecked, issues }`. Each issue includes `file`, `line`, `target`, `code`, and `message`. Issue codes include `missing-target`, `outside-root`, `invalid-target`, `read-error`, and `no-files`.

## GitHub Actions

Check your own project's instructions in CI:

```yaml
name: Instruction links
on: [push, pull_request]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm exec --yes --package=github:oh79/agent-context-check#v0.1.0 -- agent-context-check --root .
```

## JavaScript API

```js
import { checkProject } from './src/index.js';

const report = await checkProject({ root: '/path/to/project' });
console.log(report.issues);

// Optional: check only these files, relative to root.
const selected = await checkProject({
  root: '/path/to/project',
  files: ['AGENTS.md', 'docs/setup.md'],
});
```

For another project, install the tagged GitHub package and import from `agent-context-check`.

## Development

```sh
npm test
npm run check
npm pack --dry-run
```

No install step or generated build output is required. See [contributing](CONTRIBUTING.md) for how to report a parser edge case. Examples live in [examples](examples/README.md).

## License

[MIT](LICENSE). Maintained by [Seungmin Oh](https://github.com/oh79).
