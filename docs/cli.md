# Command line

`node src/cli/shop.js <command> [options]` (or `shop` when the package is linked). The CLI loads a catalog file
into an in-memory shop; nothing is kept between runs.

A catalog file holds `{ "products": [...], "priceLists": [...], "stock": { "SKU": units } }`; see
[examples/catalog.json](examples/catalog.json).

| Command | Does |
| --- | --- |
| `catalog --data <file> [--json]` | lists the products |
| `stock --data <file> [--json]` | lists the units on hand |
| `quote --data <file> --item SKU=QTY [--item ...] [--region r] [--group g] [--at <ISO date>] [--json]` | prices a basket as a retail (or `--group`) customer in `--region` |
| `import-products <file.csv> [--data <file>] [--out <file>]` | imports products from CSV; see [csv-import.md](csv-import.md) |
| `serve --data <file> [--port 8080]` | serves the HTTP API |
| `help` | prints the usage |

Exit codes: `0` success, `1` the shop refused the request (an unknown SKU, for example), `2` wrong usage or an
unreadable file.

In code, `run(argv, io)` from `src/cli/main.js` runs a command with `io = { stdout, stderr, readFile, writeFile }`
and resolves to the exit code; the tests pass a fake `io`.
