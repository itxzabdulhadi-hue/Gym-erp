import { describe, it, expect } from 'vitest';

import { toCsv, parseCsv } from '../../src/utils/csv.js';

const strip = (csv) => csv.replace(/^\uFEFF/, '');

describe('csv', () => {
  const columns = [
    { key: 'memberNo', header: 'Member No' },
    { key: 'name', header: 'Name' },
    { key: 'amount', header: 'Amount' },
  ];

  it('writes a BOM and a header row from the column labels', () => {
    const csv = toCsv([], columns);
    // The BOM is what makes Excel read the export as UTF-8.
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(strip(csv).split('\r\n')[0]).toBe('Member No,Name,Amount');
  });

  it('writes one row per record in column order', () => {
    const csv = toCsv([{ memberNo: 'M-1', name: 'Ada', amount: 10 }], columns);
    expect(strip(csv).split('\r\n')[1]).toBe('M-1,Ada,10');
  });

  it('quotes values containing commas, quotes or newlines', () => {
    const csv = toCsv([{ memberNo: 'M-2', name: 'Last, First', amount: 0 }], columns);
    expect(csv).toContain('"Last, First"');

    const quoted = toCsv([{ memberNo: 'M-3', name: 'Say "hi"', amount: 0 }], columns);
    expect(quoted).toContain('"Say ""hi"""');

    const multiline = toCsv([{ memberNo: 'M-4', name: 'line1\nline2', amount: 0 }], columns);
    expect(multiline).toContain('"line1\nline2"');
  });

  it('neutralises spreadsheet formula injection', () => {
    // A CSV opened in Excel must not execute a formula taken from member data.
    for (const payload of ['=1+1', '+1+1', '-2+2', '@SUM(A1)']) {
      const csv = toCsv([{ memberNo: 'M-5', name: payload, amount: 0 }], columns);
      const cell = strip(csv).split('\r\n')[1].split(',')[1];
      expect(cell.startsWith('=') || cell.startsWith('+') || cell.startsWith('@'), payload).toBe(false);
    }
  });

  it('handles null and undefined values', () => {
    const csv = toCsv([{ memberNo: null, name: undefined, amount: null }], columns);
    expect(strip(csv).split('\r\n')[1]).toBe(',,');
  });

  it('round-trips through parseCsv', () => {
    const rows = [
      { memberNo: 'M-1', name: 'Ada', amount: '10' },
      { memberNo: 'M-2', name: 'Last, First', amount: '0' },
    ];
    const { headers, rows: parsed } = parseCsv(toCsv(rows, columns));
    expect(headers).toEqual(['Member No', 'Name', 'Amount']);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]['Member No']).toBe('M-1');
    expect(parsed[1].Name).toBe('Last, First');
    // Line numbers come back so an import error can point at the right row.
    expect(parsed[0].__line).toBe(2);
  });

  it('parses quoted fields with embedded separators', () => {
    const { rows } = parseCsv('a,b\n"x,y","say ""hi"""\n');
    expect(rows[0].a).toBe('x,y');
    expect(rows[0].b).toBe('say "hi"');
  });
});
