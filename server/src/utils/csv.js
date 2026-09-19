/**
 * CSV serialisation for exports and imports.
 * Exports are streamed as a single string (bounded by PAGINATION.exportMaxRows)
 * with a BOM so Excel opens UTF-8 correctly.
 */

export function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCell(c.header ?? c.key)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const raw = typeof c.value === 'function' ? c.value(row) : row[c.key];
        return escapeCell(raw);
      })
      .join(','),
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const str = neutraliseFormula(value instanceof Date ? value.toISOString() : String(value));
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Spreadsheet formula injection: a cell beginning with `=`, `+`, `@`, a tab or
 * a carriage return is executed by Excel/Sheets when the export is opened, and
 * `-` too unless it is just a negative number. Member data is user supplied, so
 * every exported cell is defused here.
 */
function neutraliseFormula(str) {
  if (!str) return str;
  const first = str[0];
  if (first === '=' || first === '+' || first === '@' || first === '\t' || first === '\r') return `'${str}`;
  if (first === '-' && !/^-\d/.test(str)) return `'${str}`;
  return str;
}

/**
 * Parse a CSV string into row objects. Deliberately small and strict:
 * quoted fields, escaped quotes and CRLF are handled; anything else is an error
 * the import endpoint reports back with a line number.
 */
export function parseCsv(text) {
  const input = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!headerRow) return { headers: [], rows: [] };
  const headers = headerRow.map((h) => String(h).trim());
  const parsed = dataRows.map((r, index) => {
    const obj = { __line: index + 2 };
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows: parsed };
}
