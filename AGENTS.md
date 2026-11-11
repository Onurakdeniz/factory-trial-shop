# Working on factory-shop

The order and inventory service of a small online shop, used as a test repository for Agent Factory. Keep each
change small and explain it in the pull request.

- Read `README.md` and `docs/architecture.md` first.
- Code lives in `src/` by layer (`domain`, `app`, `http`, `cli`), tests in `test/` (`*.test.js`, Node's test runner);
  run `npm test` before you finish.
- Node 22, ES modules, no dependencies: do not add npm packages.
- Money is always an integer number of minor units (cents); never use floats for amounts.
- `src/domain` is pure: no I/O, no clock; time comes in as an argument.
- Never add keys, tokens or credentials to the repository.
