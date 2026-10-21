# agent-context-check

[![CI](https://github.com/oh79/agent-context-check/actions/workflows/ci.yml/badge.svg)](https://github.com/oh79/agent-context-check/actions/workflows/ci.yml)
[한국어](README.ko.md) · [MIT](LICENSE)

**Catch skill references that work in source but disappear from the package you ship.**

An agent can receive `SKILL.md` while its `references/` or `scripts/` files are left behind by packaging or installation. Compare the source and the prepared distribution directory before publishing. Findings point to the instruction file and line, and distinguish a broken source reference from a file missing in the artifact.

**Zero dependencies. Node.js 20+. Offline. Read-only. No API key.**

## Compare a source and a distribution

```sh
npx --yes agent-context-check@0.2.0 compare --source ./skill --artifact ./dist/skill
```

Use the same relative layout in both roots. For a tarball with a top-level `package/` folder, pass the unpacked `package/` directory as the artifact. Create or unpack the artifact with your normal build tools first. The checker never installs a skill, runs its commands, or extracts an archive.

```sh
# Machine-readable findings
npx --yes agent-context-check@0.2.0 compare --source ./skill --artifact ./dist/skill --json

# Optional instruction files, relative to the source root
npx --yes agent-context-check@0.2.0 compare --source ./skill --artifact ./dist/skill SKILL.md
```

The tool checks instruction files themselves and referenced local targets. A missing `SKILL.md` in the artifact is an error, even if its referenced files are present. Existing file/directory types must agree. This checks availability and type, not byte-for-byte equality or whether the artifact's instructions changed.

## References supported in comparison mode

- Local Markdown links, images, and reference links in discovered `AGENTS.md`, `CLAUDE.md`, and `SKILL.md` files.
- Explicit literal paths under `references/`, `scripts/`, and `assets/` in inline code.
- Literal `${CLAUDE_SKILL_DIR}/...` references, including quoted shell examples. These resolve from the instruction file's directory.
- Root-relative Markdown destinations, percent-encoded names, and Unicode filenames.

Dynamic shell expressions and globs are not executed or expanded. This is a static checker with a deliberately limited parser, not a full Markdown or shell parser. It does not prove that an agent follows the instructions. The literal placeholder destination `URL` is treated as an example, not a local filename.

Sources and artifacts are resolved to real filesystem roots. The checker reports path and symlink escapes. Automatic discovery skips symlink files/directories and `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, and `vendor`. Selecting a distribution directory itself as the artifact root is supported. Run on trusted trees; this is not a filesystem sandbox.

## GitHub Action

Add this step **after your existing build or unpack step**, with the two corresponding skill directories:

```yaml
- uses: oh79/agent-context-check@v0.2.0
  with:
    source: ./skill
    artifact: ./dist/skill
```

The action uses GitHub's Node.js 24 runtime, requires no npm install, and produces line annotations for findings. It does not need a token or write permission to your repository. Pin a release commit SHA if your workflow requires immutable dependencies.

| Input | Default | Meaning |
| --- | --- | --- |
| `mode` | `compare` | `compare` or `check` |
| `source` | `.` | Source root; also the project root in check mode |
| `artifact` | — | Prepared artifact root; required in comparison mode |
| `files` | — | Optional newline-separated paths, relative to source |

Outputs: `issues-count`, `files-checked`, and `references-checked`. Findings fail the action. Invalid configuration also fails; it is not reported as a successful empty scan.

To check only existing local Markdown links, without a distribution:

```yaml
- uses: oh79/agent-context-check@v0.2.0
  with:
    mode: check
    source: .
    files: AGENTS.md
```

## Check local Markdown links

The original checker remains available:

```sh
npx --yes agent-context-check@0.2.0 --root /path/to/project
npx --yes agent-context-check@0.2.0 --root /path/to/project --json
npx --yes agent-context-check@0.2.0 --root /path/to/project README.md docs/setup.md
```

Check mode ignores code spans/fences and checks Markdown link destinations only. File and directory targets are valid. Fragment IDs, query strings, external URLs, HTML links, undefined reference labels, and plain prose paths are not validated. It does not recursively follow documents linked from instruction files.

`npx` downloads the package when needed; the scanner itself never uses the network. To run from a checkout instead, use `node bin/agent-context-check.js` with the same arguments. A GitHub package installation is also available:

```sh
npm exec --yes --package=github:oh79/agent-context-check#v0.2.0 -- agent-context-check --help
```

## JavaScript API

```js
import { checkProject, comparePackage } from 'agent-context-check';

const comparison = await comparePackage({
  source: '/path/to/skill-source',
  artifact: '/path/to/unpacked-package',
  files: ['SKILL.md'], // optional: otherwise discover instruction files
});
console.log(comparison);

const links = await checkProject({ root: '/path/to/project' });
console.log(links);
```

Comparison reports contain `{ filesChecked, referencesChecked, issues }`. Check reports retain `{ filesChecked, linksChecked, issues }`. Each issue includes `file`, `line`, `target`, `code`, and `message`; comparison findings include source/artifact existence flags where inspected.

## Exit status

| Status | Meaning |
| --- | --- |
| `0` | No reported issues in the supported references |
| `1` | Findings, including no discovered instruction files |
| `2` | Invalid invocation or unusable root directories |

Zero findings is not a claim that every reference or instruction in a document was understood.

## Examples and development

```sh
git clone https://github.com/oh79/agent-context-check.git
cd agent-context-check
npm test
npm run check
npm pack --dry-run
node bin/agent-context-check.js compare --source examples/package-source --artifact examples/package-complete
node bin/agent-context-check.js compare --source examples/package-source --artifact examples/package-incomplete --json
```

The incomplete example intentionally fails. No install or build step is required. See [contributing](CONTRIBUTING.md), [examples](examples/README.md), and the [real package validation report](docs/validation-0.2.0.md).

## Early feedback

Do you publish a skill package? Try comparison against the exact folder your users receive. Open an issue with a minimal reproducible case and whether a finding is correct or a false alarm. Please remove secrets and private paths. Initial validation examples do not establish external adoption or ecosystem impact.

## License

[MIT](LICENSE). Maintained by [Seungmin Oh](https://github.com/oh79).
