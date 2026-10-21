# Source-to-artifact validation for 0.2.0

Validation date: 2026-10-21.

The comparison command was run against three public skill trees pinned to exact source commits. Two artifacts were published npm packages; the third was a GitHub source archive. The original artifacts passed all **41 recognized references across three `SKILL.md` files**. Separate copies with one referenced file deliberately removed each failed in **3 of 3 cases**.

These are controlled regression tests. No missing file was found in the original upstream artifacts, and this report makes no claim of upstream adoption or maintainer endorsement.

## Results

| Skill | Artifact | Recognized references | Original | File deliberately removed from a separate copy | Controlled result |
| --- | --- | ---: | --- | --- | --- |
| agent-browser core, `agent-browser@0.39.1` | Published npm tarball | 21 | Exit 0, no issues | `references/authentication.md` | Exit 1, 3 `artifact-missing` findings |
| playwright-cli, `@playwright/cli@0.1.22` | Published npm tarball | 11 | Exit 0, no issues | `references/session-management.md` | Exit 1, 1 `artifact-missing` finding |
| web-access at the commit below | GitHub source tarball | 9 | Exit 0, no issues | `scripts/check-deps.mjs` | Exit 1, 2 `artifact-missing` findings |

The three deleted files produced six findings because a file can be referenced on more than one line. Each finding had `sourceExists: true` and `artifactExists: false`, and pointed to the deliberately removed file.

## Sources and artifact identity

### agent-browser 0.39.1

- Repository: [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser).
- Source commit: `1165952d74ceed98fdc2dd97190ad41f44dd0e24`, from tag `v0.39.1`.
- Selected source tree: [`skill-data/core`](https://github.com/vercel-labs/agent-browser/tree/1165952d74ceed98fdc2dd97190ad41f44dd0e24/skill-data/core).
- Artifact: [agent-browser-0.39.1.tgz](https://registry.npmjs.org/agent-browser/-/agent-browser-0.39.1.tgz).
- Artifact skill root: `package/skill-data/core`.
- Archive SHA-256: `9efb4de1a5406f1b32dfcca2890e272053caace3369b6294d47240384e0a4732`.
- All 14 regular files in the selected source tree were present and byte-identical in the npm artifact, with no extra regular files in that tree.
- The npm metadata did not include `gitHead`. The association uses the pinned version tag and matching tree contents; signed provenance was not verified.

After deleting `references/authentication.md` from a separate artifact copy, the findings pointed to `SKILL.md` lines 233, 481, and 574.

### @playwright/cli 0.1.22

- Repository: [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli).
- Source commit: `b85c7a736bb473bf55b584e54a09ffa698d6d871`, matching the npm registry metadata's `gitHead`.
- Selected source tree: [`skills/playwright-cli`](https://github.com/microsoft/playwright-cli/tree/b85c7a736bb473bf55b584e54a09ffa698d6d871/skills/playwright-cli).
- Artifact: [cli-0.1.22.tgz](https://registry.npmjs.org/@playwright/cli/-/cli-0.1.22.tgz).
- Artifact skill root: `package/skills/playwright-cli`.
- Archive SHA-256: `bb4840be17006e2b7ba856224dc3062f6571d5f647352476f95c5e77ff5d679a`.
- All 11 regular files in the selected source tree were present and byte-identical in the npm artifact, with no extra regular files in that tree.

After deleting `references/session-management.md` from a separate artifact copy, the finding pointed to `SKILL.md` line 483. A snapshot link inside a fenced shell-output example at line 327 was correctly ignored.

### web-access source archive

- Repository: [eze-is/web-access](https://github.com/eze-is/web-access).
- Source commit: [`d173a75978ceb2c63fa0b27f7408cd2bf7fe4310`](https://github.com/eze-is/web-access/tree/d173a75978ceb2c63fa0b27f7408cd2bf7fe4310).
- Artifact: [GitHub source tarball at that exact commit](https://codeload.github.com/eze-is/web-access/tar.gz/d173a75978ceb2c63fa0b27f7408cd2bf7fe4310).
- Artifact skill root: `web-access-d173a75978ceb2c63fa0b27f7408cd2bf7fe4310`.
- Archive SHA-256: `4f3a8c13741deb67bd750f94d0c9579cb0fa8210b51e3dac47606df3943fb434`.
- The selected `SKILL.md` was byte-identical between the checkout and the source archive. Two unrelated root instruction symlinks, `CLAUDE.md` and `GEMINI.md`, were excluded during extraction; only `SKILL.md` was selected for scanning.

This is a source-archive comparison, not a test of an installer-produced directory or an npm distribution. It supplements the two published npm cases with a real skill that uses shell-variable references.

After deleting `scripts/check-deps.mjs` from a separate artifact copy, the findings pointed to `SKILL.md` lines 20 and 132. Both references use the literal `${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs` form.

## Reproduce the comparisons

Use a checkout of this release of `agent-context-check` and a separate validation workspace. Pin the source repositories to the exact commits above. Download the two published packages without running lifecycle scripts:

```sh
mkdir -p ./validation/archives
npm pack agent-browser@0.39.1 --ignore-scripts --pack-destination ./validation/archives
npm pack @playwright/cli@0.1.22 --ignore-scripts --pack-destination ./validation/archives
curl --fail --location --output ./validation/archives/web-access.tar.gz \
  https://codeload.github.com/eze-is/web-access/tar.gz/d173a75978ceb2c63fa0b27f7408cd2bf7fe4310
```

Check the downloaded archive hashes against the values above, for example with `shasum -a 256 ./validation/archives/*`. Extract the selected skill trees as data into separate artifact directories. Reject absolute paths and paths containing `..`; do not follow archive links or execute package code. Preserve the archive's root prefix when using the command templates below.

The templates assume source repositories in `validation/source/<repository>` and extracted archives in `validation/artifact/<repository>`:

```sh
node bin/agent-context-check.js compare \
  --source ./validation/source/agent-browser/skill-data/core \
  --artifact ./validation/artifact/agent-browser/package/skill-data/core \
  --json SKILL.md

node bin/agent-context-check.js compare \
  --source ./validation/source/playwright-cli/skills/playwright-cli \
  --artifact ./validation/artifact/playwright-cli/package/skills/playwright-cli \
  --json SKILL.md

node bin/agent-context-check.js compare \
  --source ./validation/source/web-access \
  --artifact ./validation/artifact/web-access/web-access-d173a75978ceb2c63fa0b27f7408cd2bf7fe4310 \
  --json SKILL.md
```

Each original comparison should exit 0 with an empty `issues` array and the reference count in the results table. Explicitly passing `SKILL.md` keeps the selected instruction-file scope consistent.

To repeat a controlled omission test, copy one extracted skill root to a new directory, remove only the file listed in the table from that copy, and compare using the original source. For example:

```sh
mkdir -p ./validation/injected
cp -R ./validation/artifact/agent-browser/package/skill-data/core \
  ./validation/injected/agent-browser
rm ./validation/injected/agent-browser/references/authentication.md

node bin/agent-context-check.js compare \
  --source ./validation/source/agent-browser/skill-data/core \
  --artifact ./validation/injected/agent-browser \
  --json SKILL.md
```

Use a fresh destination for each copy. The controlled comparison should exit 1 and report the missing file at the source lines above. Repeat with the other two selected skill roots and their listed files to reproduce all three controlled cases. Keep the original downloaded artifacts unchanged.

## Execution and evidence limits

- Only `agent-context-check` was executed for the comparisons. Vendor installers, binaries, lifecycle scripts, builds, tests, and skill instructions were not executed; package dependencies were not installed.
- Archives were inspected as data with path-containment checks. Only the needed skill trees and package metadata or license files were extracted from npm packages; vendor binaries were excluded.
- The test checks availability of recognized literal references from the selected source `SKILL.md`. It does not establish semantic correctness, full-document coverage, dynamically generated paths, or successful execution by an agent.
- The sample is three selected skills, not a measurement of ecosystem-wide false-positive or detection rates. The zero-issue original results and the 3/3 controlled detections apply to these pinned inputs.
- User adoption, repeat usage, time savings, and eligibility for any open-source benefit program were not measured.
