// A small CSV parser and writer (RFC 4180 with the usual spreadsheet habits).
//
// Fields are separated by commas and may be quoted with "; inside quotes "" is one
// quote, and commas and line breaks belong to the value (line breaks come out as
// \n). Lines end with LF or CRLF. A leading byte order mark is ignored. Empty lines
// are skipped but still counted, so every record knows the line it starts on.

import { ValidationError } from './errors.js';

/** Parses CSV text into `[{ line, fields }]`. */
export function parseCsv(text) {
  const source = String(text);
  const records = [];
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let fields = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  let quoteLine = 1;
  let empty = true;

  const endRecord = () => {
    if (!empty) {
      fields.push(field);
      records.push({ line: recordLine, fields });
    }
    fields = [];
    field = '';
    quoted = false;
    empty = true;
  };

  while (i < source.length) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else if (ch === '\r' || ch === '\n') {
        field += '\n';
        line += 1;
        i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1;
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"' && field === '' && !quoted) {
      inQuotes = true;
      quoted = true;
      quoteLine = line;
      empty = false;
      i += 1;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
      quoted = false;
      empty = false;
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1;
      line += 1;
      recordLine = line;
    } else {
      field += ch;
      empty = false;
      i += 1;
    }
  }
  if (inQuotes) {
    throw new ValidationError(`Unterminated quote starting on line ${quoteLine}`, {
      code: 'csv_unterminated_quote',
      details: { line: quoteLine },
    });
  }
  endRecord();
  return records;
}

const NEEDS_QUOTES = /[",\r\n]/;

function quoteField(value) {
  const text = String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Writes rows (lists of values) as CSV text: fields with commas, quotes or line breaks are quoted, lines end with LF. */
export function toCsv(rows) {
  return rows.map((row) => row.map(quoteField).join(',') + '\n').join('');
}
