import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, toCsv } from '../../src/domain/csv.js';

test('quoted fields, escaped quotes and commas', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\n'), [{ line: 1, fields: ['a', 'b, c', 'say "hi"'] }]);
});

test('CRLF, blank lines and multi-line values keep line numbers', () => {
  assert.deepEqual(parseCsv('﻿h1,h2\r\n\r\nx,"1\r\n2"\r\ny,3'), [
    { line: 1, fields: ['h1', 'h2'] },
    { line: 3, fields: ['x', '1\n2'] },
    { line: 5, fields: ['y', '3'] },
  ]);
});

test('an unterminated quote is an error', () => {
  assert.throws(() => parseCsv('a,"b\n'), (error) => error.code === 'csv_unterminated_quote' && error.details.line === 1);
});

test('toCsv quotes fields with commas, quotes and line breaks and ends lines with LF', () => {
  assert.equal(toCsv([['a', 'b, c', 'say "hi"', 'x\ny'], ['1', 2, '', 'z']]), 'a,"b, c","say ""hi""","x\ny"\n1,2,,z\n');
  assert.deepEqual(parseCsv(toCsv([['a,b', 'q"']])).map((r) => r.fields), [['a,b', 'q"']]);
});
