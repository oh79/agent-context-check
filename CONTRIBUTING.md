# Contributing

Small fixes and reproducible parser edge cases are welcome.

1. Open an issue with the smallest Markdown example, expected result, actual result, and Node.js/OS version. Remove secrets and private paths.
2. Add a fixture-based regression test using `node:test`. Tests use temporary directories and must not rely on network access.
3. Run `npm test`, `npm run check`, and `npm pack --dry-run` before opening a pull request.

Keep the package dependency-free. Scope is local Markdown links in agent instruction files. Remote checks, model calls, and automatic file edits are outside that scope.

Tests exercise the public `checkProject` API and CLI exit codes. Windows, macOS, and Linux run in CI; symlink tests may skip where the host cannot create symlinks.

Contributions are distributed under the [MIT license](LICENSE).
