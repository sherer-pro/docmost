import { buildDatabaseCsv, escapeDatabaseCsv } from './database-csv';

describe('database view CSV', () => {
  it('quotes commas, quotes and newlines without changing the row count', () => {
    expect(escapeDatabaseCsv('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(
      buildDatabaseCsv(
        [{ id: 'notes', name: 'Notes' }],
        [{ pageId: 'row', pageTitle: 'Record' }],
        () => 'line1\nline2',
      ),
    ).toBe('\uFEFF"Title","Notes"\r\n"Record","line1\nline2"\r\n');
  });
  it.each([
    '=1+1',
    '+cmd',
    '-1+2',
    '@SUM(A1)',
    '  =1',
    '\ttext',
    '\n=1',
    '\u0000=1',
    '\u200B=1',
  ])('neutralizes spreadsheet instructions in %j', (value) => {
    expect(escapeDatabaseCsv(value)).toBe(`"'${value}"`);
  });
});
