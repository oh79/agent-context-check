# Examples

Run the valid fixture from the repository root:

```sh
node bin/agent-context-check.js --root examples/valid
```

Run the intentionally broken fixture (expected exit status 1):

```sh
node bin/agent-context-check.js --root examples/broken --json
```

Both fixtures are included in automatic discovery when checking this whole repository, so `npm run check` explicitly checks only the root instruction file.
