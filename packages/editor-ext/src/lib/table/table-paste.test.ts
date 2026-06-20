import { describe, expect, it } from 'vitest';
import { parseTsvTable } from './table-paste';

describe('parseTsvTable', () => {
  it('parses rectangular TSV input', () => {
    expect(parseTsvTable('Name\tStatus\nAlpha\tOpen\nBeta\tClosed')).toEqual([
      ['Name', 'Status'],
      ['Alpha', 'Open'],
      ['Beta', 'Closed'],
    ]);
  });

  it('normalizes CRLF and trims trailing empty rows', () => {
    expect(parseTsvTable('A\tB\r\n1\t2\r\n\t\r\n')).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('rejects non-table and ragged TSV input', () => {
    expect(parseTsvTable('plain text')).toBeNull();
    expect(parseTsvTable('A\tB\n1')).toBeNull();
    expect(parseTsvTable('A\tB')).toBeNull();
  });
});
