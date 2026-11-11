# Importing products from CSV

The merchandising sheet can be loaded with `shop import-products` or `POST /products/import`.

## File format

- Comma-separated, UTF-8 (a leading byte order mark is ignored), LF or CRLF line ends.
- Values may be quoted with `"`; inside quotes `""` is a quote, and commas and line breaks are part of the value.
- Empty lines are skipped. Error reports give the line on which a record starts, counting the header as line 1.

The first line is the header. Names are matched case-insensitively; spaces and dashes count as underscores.

| Column | Aliases | Required | Values |
| --- | --- | --- | --- |
| `sku` | | yes | upper-cased; letters, digits and dashes |
| `name` | `title` | yes | at most 120 characters |
| `price` | `unit_price` | yes | euros with a dot and at most two decimals: `12`, `12.5`, `12.50` |
| `tax_category` | `tax` | no | `standard` (default), `reduced`, `zero` |
| `active` | | no | `yes/no/true/false/1/0`; empty means active |
| `tags` | | no | separated by `;` |
| `description` | | no | free text |

Other columns are ignored and listed in the report. A missing required column stops the import (`missing_column`).

## Rows

Valid rows are imported; invalid rows are rejected, with one error `{ line, sku, field, message }` per problem. A row
with more fields than the header is rejected (`field: null`). When a SKU appears twice in the file, the first row
counts. A SKU that is already in the catalog is **updated** with the columns the file has; columns the file does not
have keep their values. (The spec left this open; we treat the sheet as the master for the columns it contains.)

The report is `{ imported, rejected, errors, ignoredColumns }`.

## Command

```sh
shop import-products products.csv --data docs/examples/catalog.json --out catalog.json
```

Without `--data` the import starts from an empty catalog. `--out` writes the resulting catalog file. Exit codes: `0`
all rows imported, `1` some rows rejected (the valid ones are still written), `2` wrong usage, an unreadable file, an
unterminated quote or a missing required column.
