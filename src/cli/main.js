// The `shop` command line. `run(argv, io)` returns the exit code:
// 0 success, 1 the shop refused the request, 2 wrong usage or unreadable input.

import { readFileSync, writeFileSync } from 'node:fs';
import { createManualClock, systemClock } from '../app/clock.js';
import { importProducts } from '../app/product-import.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor } from '../domain/money.js';
import { formatQuote } from '../domain/totals.js';
import { createApp } from '../http/app.js';
import { startServer } from '../http/server.js';
import { UsageError, optionList, parseArgs, requireOption } from './args.js';
import { dumpShop, loadShop, readDataFile } from './load-data.js';

export const USAGE = `Usage: shop <command> [options]

Commands:
  catalog  --data <file> [--json]             List the products in a catalog file
  stock    --data <file> [--json]             List the units on hand per SKU
  quote    --data <file> --item SKU=QTY ...   Price a basket
           [--region domestic|eu|world] [--group retail|wholesale] [--at <ISO date>] [--json]
  import-products <file.csv> [--data <file>] [--out <file>]
                                              Import products from CSV; --out writes the catalog
  serve    --data <file> [--port 8080]        Serve the HTTP API on the catalog
  help                                        Show this text
`;

export function defaultIo() {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, text) => writeFileSync(path, text),
  };
}

function print(io, text) {
  io.stdout.write(`${text}\n`);
}

function clockFor(options) {
  if (options.at === undefined) return systemClock;
  const at = Date.parse(options.at);
  if (Number.isNaN(at)) throw new UsageError(`--at is not a date: ${options.at}`);
  return createManualClock(at);
}

function parseItem(text) {
  const match = /^([^=]+)=(\d+)$/.exec(text);
  if (!match) throw new UsageError(`--item must look like SKU=QTY, got ${text}`);
  return { sku: match[1], quantity: Number(match[2]) };
}

function catalogCommand({ options, io }) {
  const shop = loadShop(readDataFile(io, requireOption(options, 'data')));
  const products = shop.catalog.listProducts();
  if (options.json) {
    print(io, JSON.stringify(products, null, 2));
    return 0;
  }
  for (const product of products) {
    const flags = product.active ? '' : '  (inactive)';
    print(io, `${product.sku.padEnd(14)} ${product.name.padEnd(32)} ${formatMinor(product.basePriceMinor).padStart(13)}  ${product.taxCategory}${flags}`);
  }
  print(io, `${products.length} products`);
  return 0;
}

function stockCommand({ options, io }) {
  const shop = loadShop(readDataFile(io, requireOption(options, 'data')));
  const stock = shop.inventory.listStock();
  if (options.json) {
    print(io, JSON.stringify(stock, null, 2));
    return 0;
  }
  for (const item of stock) print(io, `${item.sku.padEnd(14)} ${String(item.onHand).padStart(6)}`);
  return 0;
}

function quoteCommand({ options, io }) {
  const items = optionList(options, 'item').map(parseItem);
  if (items.length === 0) throw new UsageError('quote needs at least one --item SKU=QTY');
  const shop = loadShop(readDataFile(io, requireOption(options, 'data')), { clock: clockFor(options) });
  const cart = shop.carts.createCart({
    customerId: 'cli',
    customerGroup: options.group ?? 'retail',
    region: options.region ?? 'domestic',
  });
  for (const item of items) shop.carts.addItem(cart.id, item);
  const quote = shop.carts.quote(cart.id);
  print(io, options.json ? JSON.stringify(quote, null, 2) : formatQuote(quote));
  return 0;
}

function importCommand({ positionals, options, io }) {
  const [file] = positionals;
  if (!file) throw new UsageError('import-products needs a CSV file');
  const shop = loadShop(options.data === undefined ? {} : readDataFile(io, requireOption(options, 'data')));
  let text;
  try {
    text = io.readFile(file);
  } catch (error) {
    throw new UsageError(`Cannot read ${file}: ${error.code ?? error.message}`);
  }
  let report;
  try {
    report = importProducts(shop, text);
  } catch (error) {
    if (error instanceof DomainError && ['missing_column', 'csv_unterminated_quote'].includes(error.code)) {
      throw new UsageError(error.message);
    }
    throw error;
  }
  print(io, `imported ${report.imported}, rejected ${report.rejected}`);
  for (const column of report.ignoredColumns) print(io, `ignored column: ${column}`);
  for (const error of report.errors) {
    io.stderr.write(`line ${error.line}${error.sku ? ` (${error.sku})` : ''}: ${error.field ?? 'row'}: ${error.message}\n`);
  }
  if (options.out !== undefined) io.writeFile(requireOption(options, 'out'), `${JSON.stringify(dumpShop(shop), null, 2)}\n`);
  return report.rejected > 0 ? 1 : 0;
}

async function serveCommand({ options, io }) {
  const shop = loadShop(readDataFile(io, requireOption(options, 'data')));
  const port = Number(options.port ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port is not a port: ${options.port}`);
  const { port: bound } = await startServer({ app: createApp(shop), port });
  print(io, `shop API listening on http://127.0.0.1:${bound}`);
  return 0;
}

const COMMANDS = {
  catalog: catalogCommand,
  stock: stockCommand,
  quote: quoteCommand,
  'import-products': importCommand,
  serve: serveCommand,
  help: ({ io }) => {
    io.stdout.write(USAGE);
    return 0;
  },
};

export async function run(argv, io = defaultIo()) {
  const { command, positionals, options } = parseArgs(argv);
  const handler = COMMANDS[command];
  if (!handler) {
    io.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    return 2;
  }
  try {
    return (await handler({ positionals, options, io })) ?? 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`error: ${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof DomainError) {
      io.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
