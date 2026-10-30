export function escapeDatabaseCsv(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildDatabaseCsv(
  properties: Array<{ id: string; name: string }>,
  rows: Array<{
    pageId: string;
    pageTitle?: string;
    page?: { title?: string };
  }>,
  display: (row: any, propertyId: string) => string,
): string {
  return (
    '\uFEFF' +
    [
      ['Title', ...properties.map((p) => p.name)],
      ...rows.map((row) => [
        row.pageTitle ?? row.page?.title ?? '',
        ...properties.map((p) => display(row, p.id)),
      ]),
    ]
      .map((row) => row.map(escapeDatabaseCsv).join(','))
      .join('\r\n') +
    '\r\n'
  );
}
