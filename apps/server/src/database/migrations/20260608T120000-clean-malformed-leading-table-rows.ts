import { type Kysely, sql } from 'kysely';

type JsonNode = Record<string, any>;

function parseJsonContent(input: unknown): unknown {
  let value = input;

  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function isJsonNode(input: unknown): input is JsonNode {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input));
}

function hasMeaningfulContent(input: unknown): boolean {
  if (Array.isArray(input)) {
    return input.some((item) => hasMeaningfulContent(item));
  }

  if (!isJsonNode(input)) {
    return false;
  }

  if (typeof input.text === 'string' && input.text.trim()) {
    return true;
  }

  if (Array.isArray(input.content)) {
    return input.content.some((item) => hasMeaningfulContent(item));
  }

  if (!input.type || input.type === 'paragraph' || input.type === 'hardBreak') {
    return false;
  }

  return input.type !== 'text';
}

function isTableCellNode(input: unknown): input is JsonNode {
  return (
    isJsonNode(input) &&
    (input.type === 'tableCell' || input.type === 'tableHeader')
  );
}

function isEmptyTableRow(row: JsonNode): boolean {
  if (row.type !== 'tableRow' || !Array.isArray(row.content)) {
    return false;
  }

  const cells = row.content.filter((cell) => isTableCellNode(cell));

  return (
    cells.length > 0 &&
    cells.length === row.content.length &&
    cells.every((cell) => !hasMeaningfulContent(cell))
  );
}

function isHeaderOnlyRow(row: JsonNode): boolean {
  return (
    row.type === 'tableRow' &&
    Array.isArray(row.content) &&
    row.content.length > 0 &&
    row.content.every((cell) => isJsonNode(cell) && cell.type === 'tableHeader')
  );
}

function isRegularCellOnlyRow(row: JsonNode): boolean {
  return (
    row.type === 'tableRow' &&
    Array.isArray(row.content) &&
    row.content.length > 0 &&
    row.content.every((cell) => isJsonNode(cell) && cell.type === 'tableCell')
  );
}

function isTableCellOnlyRow(row: JsonNode): boolean {
  return (
    row.type === 'tableRow' &&
    Array.isArray(row.content) &&
    row.content.length > 0 &&
    row.content.every((cell) => isTableCellNode(cell))
  );
}

function getTableRowColumnCount(row: JsonNode): number {
  if (!Array.isArray(row.content)) {
    return 0;
  }

  return row.content.reduce((count, cell) => {
    if (!isJsonNode(cell)) {
      return count;
    }

    return count + Number(cell.attrs?.colspan ?? 1);
  }, 0);
}

function convertRowCellsToHeaders(row: JsonNode): JsonNode {
  if (!Array.isArray(row.content)) {
    return row;
  }

  return {
    ...row,
    content: row.content.map((cell) => {
      if (!isJsonNode(cell) || cell.type === 'tableHeader') {
        return cell;
      }

      return { ...cell, type: 'tableHeader' };
    }),
  };
}

function normalizeTableNode(table: JsonNode): {
  value: JsonNode;
  changed: boolean;
} {
  if (table.type !== 'table' || !Array.isArray(table.content)) {
    return { value: table, changed: false };
  }

  const rows = table.content.filter(
    (row): row is JsonNode => isJsonNode(row) && row.type === 'tableRow',
  );

  if (rows.length !== table.content.length || rows.length < 2) {
    return { value: table, changed: false };
  }

  const firstContentRowIndex = rows.findIndex((row) => !isEmptyTableRow(row));

  if (firstContentRowIndex <= 0 || firstContentRowIndex > 2) {
    return { value: table, changed: false };
  }

  const leadingRows = rows.slice(0, firstContentRowIndex);
  const firstContentRow = rows[firstContentRowIndex];
  const firstContentColumnCount = getTableRowColumnCount(firstContentRow);

  if (
    firstContentColumnCount === 0 ||
    !isHeaderOnlyRow(leadingRows[0]) ||
    !isTableCellOnlyRow(firstContentRow)
  ) {
    return { value: table, changed: false };
  }

  if (leadingRows.length === 2 && !isRegularCellOnlyRow(leadingRows[1])) {
    return { value: table, changed: false };
  }

  if (
    leadingRows.some(
      (row) => getTableRowColumnCount(row) !== firstContentColumnCount,
    )
  ) {
    return { value: table, changed: false };
  }

  return {
    value: {
      ...table,
      content: [
        convertRowCellsToHeaders(firstContentRow),
        ...rows.slice(firstContentRowIndex + 1),
      ],
    },
    changed: true,
  };
}

function cleanMalformedLeadingTableRows(input: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (Array.isArray(input)) {
    let changed = false;
    const value = input.map((item) => {
      const cleaned = cleanMalformedLeadingTableRows(item);
      changed = changed || cleaned.changed;
      return cleaned.value;
    });

    return { value, changed };
  }

  if (!isJsonNode(input)) {
    return { value: input, changed: false };
  }

  let changed = false;
  const next: JsonNode = { ...input };

  if (Array.isArray(input.content)) {
    const cleaned = cleanMalformedLeadingTableRows(input.content);
    if (cleaned.changed) {
      changed = true;
      next.content = cleaned.value;
    }
  }

  const normalized = normalizeTableNode(next);

  return {
    value: normalized.value,
    changed: changed || normalized.changed,
  };
}

export async function up(db: Kysely<any>): Promise<void> {
  const result = await sql<{ id: string; content: unknown }>`
    select id, content
    from pages
    where jsonb_path_exists(content, '$.** ? (@.type == "table")')
  `.execute(db);

  for (const row of result.rows) {
    const cleaned = cleanMalformedLeadingTableRows(
      parseJsonContent(row.content),
    );
    if (!cleaned.changed) {
      continue;
    }

    await sql`
      update pages
      set content = ${sql.lit(JSON.stringify(cleaned.value))}::jsonb,
          ydoc = null
      where id = ${row.id}
    `.execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Removed placeholder rows cannot be reconstructed.
}
