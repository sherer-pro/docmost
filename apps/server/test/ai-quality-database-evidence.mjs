import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

function transmittedToolResults(requests, caseId) {
  const results = [];
  for (const request of requests) {
    if (
      request.caseId !== caseId ||
      request.transmitted !== true ||
      request.transportError
    )
      continue;
    for (const message of request.messages ?? []) {
      if (message.role !== 'tool') continue;
      const texts =
        typeof message.content === 'string'
          ? [message.content]
          : Array.isArray(message.content)
            ? message.content
                .filter(
                  (part) =>
                    part?.type === 'text' && typeof part.text === 'string',
                )
                .map((part) => part.text)
            : [];
      for (const text of texts) {
        try {
          const decoded = JSON.parse(text);
          if (decoded?.ok === true && decoded.result)
            results.push(decoded.result);
        } catch {
          // Incomplete or non-JSON messages cannot prove row transmission.
        }
      }
    }
  }
  return results;
}

function matchesFixture(row, fixture) {
  const index = fixture.records.findIndex(
    (record) => record.pageId === row.pageId,
  );
  if (index < 0) return false;
  const record = fixture.records[index];
  const expected = new Map([
    [fixture.properties.budgetId, record.budget ?? null],
    [fixture.properties.statusId, record.status ?? null],
    [fixture.properties.dateId, record.date ?? null],
    [fixture.properties.notesId, record.notes ?? null],
  ]);
  return (
    row.title === 'Работа ' + String(index + 1).padStart(4, '0') &&
    Array.isArray(row.cells) &&
    row.cells.length === expected.size &&
    new Set(row.cells.map((cell) => cell.propertyId)).size === expected.size &&
    row.cells.every(
      (cell) =>
        expected.has(cell.propertyId) &&
        isDeepStrictEqual(cell.value, expected.get(cell.propertyId)),
    )
  );
}

export function projectDatabaseRowEvidence({
  caseId,
  evidence,
  toolCalls,
  providerRequests,
  fixture,
}) {
  const transmitted = transmittedToolResults(providerRequests, caseId);
  return evidence.map((source) => {
    for (const call of toolCalls) {
      if (
        call.name !== 'listDatabaseRows' ||
        call.status !== 'completed' ||
        call.result?.databaseId !== fixture.databaseId ||
        !Array.isArray(call.result.items) ||
        !Array.isArray(call.result.docmostCitations)
      )
        continue;
      const citation = call.result.docmostCitations?.find(
        (item) =>
          item.marker === '[' + source.marker + ']' &&
          item.source?.sourceType === 'database_row' &&
          item.source.sourceId === (source.runtimeSourceId ?? source.sourceId),
      );
      if (!citation) continue;
      const row = call.result.items?.find(
        (item) =>
          item.id === citation.source.sourceId &&
          item.pageId === citation.source.pageId &&
          item.title === citation.source.sourceTitle,
      );
      if (!row) continue;
      const seeded = fixture.records.find(
        (record) => record.pageId === row.pageId,
      );
      const text = JSON.stringify(row);
      return {
        ...source,
        sourceId: row.pageId,
        runtimeSourceId: row.id,
        sourceType: 'database_row',
        pageId: row.pageId,
        text,
        observedRowSha256: createHash('sha256').update(text).digest('hex'),
        verification:
          'completed scoped server read; immutable seeded row; exact row and citation in one transmitted tool result',
        readable: seeded?.readable === true && seeded?.aiAllowed === true,
        current: matchesFixture(row, fixture),
        transmitted: transmitted.some(
          (result) =>
            result.databaseId === fixture.databaseId &&
            Array.isArray(result.docmostCitations) &&
            result.docmostCitations.some(
              (item) =>
                item.marker === citation.marker &&
                item.sourceTitle === row.title,
            ) &&
            Array.isArray(result.items) &&
            result.items.some((item) => isDeepStrictEqual(item, row)),
        ),
      };
    }
    return source;
  });
}
