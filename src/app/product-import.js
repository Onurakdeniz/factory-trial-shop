// Product import from CSV: header mapping, row-level validation, and a report.
//
// Valid rows are imported even when other rows are rejected. A SKU that is already
// in the catalog is updated with the values the row gives (columns the file does not
// have are left alone); it is counted as imported. Assumption, since the spec leaves
// it open: the merchandising sheet is the master for the columns it contains.

import { DomainError, ValidationError } from '../domain/errors.js';
import { parseCsv } from '../domain/csv.js';
import { parseMajor } from '../domain/money.js';
import { SKU_PATTERN, TAX_CATEGORIES, normalizeSku } from '../domain/product.js';

const COLUMNS = {
  sku: 'sku',
  name: 'name',
  title: 'name',
  price: 'price',
  unit_price: 'price',
  tax_category: 'tax_category',
  tax: 'tax_category',
  active: 'active',
  tags: 'tags',
  description: 'description',
};
const REQUIRED = ['sku', 'name', 'price'];
const BOOLEANS = { yes: true, true: true, 1: true, no: false, false: false, 0: false };
const PRICE = /^\d+(\.\d{1,2})?$/;

const headerKey = (name) => name.trim().toLowerCase().replace(/[\s-]+/g, '_');

function mapHeader(fields) {
  const columns = new Map();
  const ignoredColumns = [];
  fields.forEach((name, index) => {
    const column = COLUMNS[headerKey(name)];
    if (column === undefined || columns.has(column)) ignoredColumns.push(name);
    else columns.set(column, index);
  });
  const missing = REQUIRED.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new ValidationError(`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, {
      code: 'missing_column',
      details: { columns: missing },
    });
  }
  return { columns, ignoredColumns };
}

/** Validates one row; returns `{ input, problems }`. */
function readRow(values, columns) {
  const problems = [];
  const problem = (field, message) => problems.push({ field, message });
  const value = (column) => (columns.has(column) ? (values[columns.get(column)] ?? '').trim() : undefined);

  const sku = normalizeSku(value('sku'));
  if (!SKU_PATTERN.test(sku)) problem('sku', 'must be 2 to 32 letters, digits or dashes');
  const name = value('name');
  if (name === '') problem('name', 'is required');
  else if (name.length > 120) problem('name', 'must be at most 120 characters');
  const input = { sku, name };

  const price = value('price');
  if (!PRICE.test(price)) problem('price', `must be an amount like 12.50, got "${price}"`);
  else input.basePriceMinor = parseMajor(price);

  const tax = value('tax_category');
  if (tax !== undefined) {
    const category = tax === '' ? 'standard' : tax.toLowerCase();
    if (!TAX_CATEGORIES.includes(category)) problem('tax_category', `must be one of ${TAX_CATEGORIES.join(', ')}`);
    else input.taxCategory = category;
  }
  const active = value('active');
  if (active !== undefined) {
    const flag = active === '' ? true : BOOLEANS[active.toLowerCase()];
    if (flag === undefined) problem('active', 'must be yes, no, true, false, 1 or 0');
    else input.active = flag;
  }
  const tags = value('tags');
  if (tags !== undefined) input.tags = tags.split(';').map((tag) => tag.trim()).filter(Boolean);
  const description = value('description');
  if (description !== undefined) input.description = description;
  return { input, problems };
}

/**
 * Imports products from CSV text into `shop`. Returns
 * `{ imported, rejected, errors: [{ line, sku, field, message }], ignoredColumns }`.
 * Throws `missing_column` (nothing imported) when a required column is missing.
 */
export function importProducts(shop, csvText) {
  const [header, ...rows] = parseCsv(csvText);
  if (!header) {
    throw new ValidationError('The file is empty', { code: 'missing_column', details: { columns: REQUIRED } });
  }
  const { columns, ignoredColumns } = mapHeader(header.fields);
  const report = { imported: 0, rejected: 0, errors: [], ignoredColumns };
  const firstLine = new Map();

  for (const row of rows) {
    const reject = (problems, sku) => {
      report.rejected += 1;
      for (const { field, message } of problems) report.errors.push({ line: row.line, sku, field, message });
    };
    if (row.fields.length > header.fields.length) {
      reject([{ field: null, message: `has ${row.fields.length} fields, the header has ${header.fields.length}` }], normalizeSku(row.fields[columns.get('sku')]));
      continue;
    }
    const { input, problems } = readRow(row.fields, columns);
    if (problems.length === 0 && firstLine.has(input.sku)) {
      problems.push({ field: 'sku', message: `appears again; line ${firstLine.get(input.sku)} counts` });
    }
    if (problems.length > 0) {
      reject(problems, input.sku);
      continue;
    }
    try {
      if (shop.catalog.findProduct(input.sku)) {
        const { sku, ...patch } = input;
        shop.catalog.updateProduct(sku, patch);
      } else {
        shop.catalog.addProduct(input);
      }
      firstLine.set(input.sku, row.line);
      report.imported += 1;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      reject([{ field: error.details?.field ?? null, message: error.message }], input.sku);
    }
  }
  return report;
}
