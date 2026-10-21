# Three reported installation regressions

Checked on 2026-10-21. The three cases below replay documented copy steps or the real pinned `skills@1.5.25` installer. No files were deliberately removed from the installed artifacts to create these failures.

The installation replays ran on macOS arm64 with Node.js 25.8.0. They test static resource availability, not the reporters' agent sessions. Vendor skill scripts, Claude, Codex, Salesforce commands, and analysis code were not executed. npm lifecycle scripts were disabled for the installer downloads; the pinned skills CLI itself was executed in isolated temporary Git projects, without global installation.

## Before and after

| Report and selected scope | 0.2.0 | 0.3.0 on the same actual artifact | Separate complete control |
| --- | --- | --- | --- |
| [everyday-causal-skills #4](https://github.com/RobsonTigre/everyday-causal-skills/issues/4), `causal-did` | Exit 1, 6 references / 6 `source-missing` | Exit 1, 10 references / 10 `source-missing`; now includes four template occurrences | Exit 0, 10 references, no issues |
| [Salesforce sf-skills #370](https://github.com/forcedotcom/sf-skills/issues/370), five reported skills | Exit 0, 0 references / no issues | Exit 1, 10 references / 10 `unresolved-variable` | Exit 0, 10 references, no issues, with explicit plugin root |
| [ai-dotfiles #1](https://github.com/seanedwards/ai-dotfiles/issues/1), `using-bazzite` | Exit 0, 0 references / no issues | Exit 1, 75 references / 75 `artifact-missing` | Exit 0, 75 references, no issues |

These findings mean different things. The causal case was already rejected by 0.2.0; 0.3.0 improves template coverage. The Salesforce finding reports unknown plugin context, not an inspected missing file or proof that a host's environment variable is unset. The ai-dotfiles findings compare existing source paths with absent installed paths. All complete controls are separately prepared local data copies, not outputs of fixed upstream installers.

The release includes [machine-readable before/after captures](https://github.com/oh79/agent-context-check/releases/download/v0.3.0/agent-context-check-0.3.0-validation.json), including the final scanner source hash and the six final comparison reports. Commands below recreate the inputs; the captures contain relative finding paths without local machine paths.

## 1. everyday-causal-skills: shared resources omitted by the documented copy

Pinned source: [`5317ebc8affd36a7132739d480ccfae22f4bb3ad`](https://github.com/RobsonTigre/everyday-causal-skills/tree/5317ebc8affd36a7132739d480ccfae22f4bb3ad), plugin 0.6.0. This was also upstream HEAD when checked. The issue remained open.

The README copies `skills/*` to the Codex skills directory. Repeating that copy into an isolated destination produced 14 skill directories. The selected `causal-did/SKILL.md` was byte-identical to its source (SHA-256 `a0cdcc88d633068f22fdef889c2cb89053c5929bf5f5a49490ed3353d15cb8dd`).

Six referenced resources exist at repository root but are absent beside both the source and installed `causal-did/SKILL.md`:

| Resource | Source instruction lines |
| --- | --- |
| `references/lessons.md` | 15, 306 |
| `references/assumptions/did.md` | 16, 62 |
| `references/method-registry.md` | 17 |
| `references/preflight.md` | 98 |
| `templates/r/did.md` | 96, 100 |
| `templates/python/did.md` | 96, 100 |

The checker resolves relative paths beside the instruction file. It therefore reports `source-missing`, with both existence flags false. It does not search parent folders or reinterpret these as repository-root paths. This identifies a portability problem under that explicit interpretation; it does not claim the repository-root resources themselves are missing.

### Reproduce

Use a fresh temporary directory. All commands below are POSIX shell examples; `npx` downloads the checker, while the scanner itself stays offline.

```sh
repro_dir=$(mktemp -d)
git clone --no-checkout --filter=blob:none \
  https://github.com/RobsonTigre/everyday-causal-skills.git "$repro_dir/source"
git -C "$repro_dir/source" -c core.hooksPath=/dev/null checkout --detach \
  5317ebc8affd36a7132739d480ccfae22f4bb3ad
mkdir -p "$repro_dir/installed"
cp -R "$repro_dir/source/skills/"* "$repro_dir/installed/"

npx --yes agent-context-check@0.3.0 compare \
  --source "$repro_dir/source/skills/causal-did" \
  --artifact "$repro_dir/installed/causal-did" --json SKILL.md
# Exit 1: 10 source-missing findings, including the template paths.
```

For the separate complete control, copy the selected skill plus the existing repository-root `references/` and `templates/` into **each** new control directory, beside its unchanged `SKILL.md`. Include the upstream MIT LICENSE. Comparing these two controls gives 10 recognized references and no findings. This models the reporter's proposed bundling workaround; no causal analysis was run.

## 2. Salesforce: standalone skills depend on plugin-root scripts

Pinned source: [`4bbae5c421e51b40e4169afa72c4496372a602a7`](https://github.com/forcedotcom/sf-skills/tree/4bbae5c421e51b40e4169afa72c4496372a602a7), the full commit behind the report's `4bbae5c`. The issue and [fix PR #371](https://github.com/forcedotcom/sf-skills/pull/371) remained open and the PR was unmerged when checked. This is a replay of the reported revision, not a claim that every later revision or installer release has the same behavior.

The real CLI received the pinned GitHub tree URL, discovered the repository root, and reported 256 installed skills. Verification selected the five named in the report. Each installed skill directory contained only `SKILL.md`, byte-identical to its corresponding source. The lock recorded the exact source ref and `plugins/builder/salesforce-development/skills/.../SKILL.md` paths.

The source plugin contains `scripts/sf-deploy-gate` and `scripts/sf-context`. They were absent beside the selected installed skills and at the installed skills root.

| Selected skill | Source instruction lines | Plugin resource |
| --- | --- | --- |
| `platform-deploy-validate` | 33 | `scripts/sf-deploy-gate` |
| `platform-destructive-deploy` | 97 | `scripts/sf-deploy-gate` |
| `platform-quick-deploy` | 20 | `scripts/sf-deploy-gate` |
| `platform-capability-search` | 26, 33, 35, 37, 46 | `scripts/sf-context` |
| `platform-environment-validate` | 18, 49 | `scripts/sf-context` |

All ten concrete references use `${CLAUDE_PLUGIN_ROOT}/...`. 0.2.0 skipped them. Without an explicitly declared plugin root, 0.3.0 emits `unresolved-variable` and omits `sourceExists` and `artifactExists`: it did not resolve a plugin target. This is a static context diagnostic, not runtime environment inspection, a Salesforce deployment test, or a replacement for the proposed guarded fallback.

### Reproduce

```sh
repro_dir=$(mktemp -d)
git clone --no-checkout --filter=blob:none \
  https://github.com/forcedotcom/sf-skills.git "$repro_dir/source"
git -C "$repro_dir/source" -c core.hooksPath=/dev/null checkout --detach \
  4bbae5c421e51b40e4169afa72c4496372a602a7
mkdir "$repro_dir/installed"
cd "$repro_dir/installed"
git init -q
npm exec --yes --ignore-scripts --cache "$repro_dir/npm-cache" --package=skills@1.5.25 -- \
  skills add https://github.com/forcedotcom/sf-skills/tree/4bbae5c421e51b40e4169afa72c4496372a602a7 \
  -a claude-code -s '*' -y --copy

npx --yes agent-context-check@0.3.0 compare \
  --source "$repro_dir/source/plugins/builder/salesforce-development/skills" \
  --artifact "$repro_dir/installed/.claude/skills" --json \
  platform-deploy-validate/SKILL.md \
  platform-destructive-deploy/SKILL.md \
  platform-quick-deploy/SKILL.md \
  platform-capability-search/SKILL.md \
  platform-environment-validate/SKILL.md
# Exit 1: 10 unresolved-variable findings.
```

The complete control was a manual copy of the entire pinned `plugins/builder/salesforce-development` tree, including its scripts. Comparing that source plugin to the copy with `--plugin-root .` and the five corresponding `skills/<name>/SKILL.md` paths gives 10 recognized references and no findings. It was not installed through the native Claude plugin installer.

## 3. ai-dotfiles: a documentation submodule arrives empty

Pinned source: [`47f9d2f740fdb7c864a74b9c7107f3a8395f7841`](https://github.com/seanedwards/ai-dotfiles/tree/47f9d2f740fdb7c864a74b9c7107f3a8395f7841). The selected `using-bazzite` skill declares documentation gitlink [`b2a7f7bdc0f3bb83c79469a294359a0364a59cfc`](https://github.com/ublue-os/docs.bazzite.gg/tree/b2a7f7bdc0f3bb83c79469a294359a0364a59cfc). The issue and upstream [submodule fix PR #2105](https://github.com/vercel-labs/skills/pull/2105) remained open; that PR was unmerged when checked.

The original issue used `skills@latest` and reported several skills. This replay pins 1.5.25 and tests one `using-bazzite` installation. The real installer reported success, but its installed `docs/` was empty. The source comparison tree was prepared with the exact public documentation gitlink over HTTPS, without changing the original `.gitmodules`, source checkout, or actual installed artifact.

- Prepared source: 246 regular documentation files. Installed artifact: 0 documentation files.
- `SKILL.md` was byte-identical in source and artifact (SHA-256 `bf354b4afedc0f974deabe848da2c0fb4e5d63e9d8d9ecca35af670ebbbd36ce`).
- 75 recognized `docs/...` occurrences name 71 unique targets. All exist in the prepared source and are absent from the installed artifact.
- Examples: `docs/src/` at line 17, `docs/src/General/FAQ.md` at line 35, `docs/src/index.md` at line 43.
- 0.3.0 returns 75 `artifact-missing` findings with `sourceExists: true` and `artifactExists: false`.

### Reproduce

```sh
repro_dir=$(mktemp -d)
git clone --no-checkout --filter=blob:none \
  https://github.com/seanedwards/ai-dotfiles.git "$repro_dir/source"
git -C "$repro_dir/source" -c core.hooksPath=/dev/null checkout --detach \
  47f9d2f740fdb7c864a74b9c7107f3a8395f7841
git clone --no-checkout --filter=blob:none \
  https://github.com/ublue-os/docs.bazzite.gg.git "$repro_dir/docs-source"
git -C "$repro_dir/docs-source" -c core.hooksPath=/dev/null checkout --detach \
  b2a7f7bdc0f3bb83c79469a294359a0364a59cfc
cp -R "$repro_dir/source/bazzite/skills/using-bazzite" "$repro_dir/complete-source"
mkdir -p "$repro_dir/complete-source/docs"
cp -R "$repro_dir/docs-source/src" "$repro_dir/complete-source/docs/src"

mkdir "$repro_dir/installed"
cd "$repro_dir/installed"
git init -q
npm exec --yes --ignore-scripts --cache "$repro_dir/npm-cache" --package=skills@1.5.25 -- \
  skills add https://github.com/seanedwards/ai-dotfiles/tree/47f9d2f740fdb7c864a74b9c7107f3a8395f7841 \
  --skill using-bazzite --agent claude-code --yes --copy

npx --yes agent-context-check@0.3.0 compare \
  --source "$repro_dir/complete-source" \
  --artifact "$repro_dir/installed/.claude/skills/using-bazzite" --json SKILL.md
# Exit 1: 75 artifact-missing findings.
```

For the complete control, copy the actual installed skill into a new directory and fill its `docs/src/` from the prepared source. Comparing that separate control gives 75 references and no findings. This is a local correction, not an upstream release or installer fix.

## Scanner changes and limits

- Comparison now recognizes concrete inline `docs/` and `templates/` resource paths, in addition to `references/`, `scripts/`, and `assets/`.
- Concrete plugin-root references no longer silently pass when plugin context is unknown. `--plugin-root` / API `pluginRoot` / Action input `plugin-root` declare a relative plugin location inside both comparison trees. The scanner does not read ambient plugin environment variables or infer parent roots.
- Directory availability and file type are checked; content equality and runtime behavior are not. Dynamic shell expressions, globs, and conditional fallback execution are not evaluated.
- Original installation artifacts are unchanged. Complete controls retain the original skill contents and provide existing pinned resources separately. No third-party skill code or full trees are vendored into the checker package.
- Baseline captures used 0.2.0; after captures used the 0.3.0 code. The installer package was pinned to `skills@1.5.25`, registry SHA-1 `763f5246a098e3999f5cf2edc3e0c8c2aeda0385`.
- These are three selected reported regressions. They do not establish an ecosystem-wide detection rate, maintainer adoption, endorsement, or successful execution by an agent. Upstream issue/PR states above are snapshots, not a promise of current status.
