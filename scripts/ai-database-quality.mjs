// Compare recorded server tool traces, never a model's claim that it used a tool.
export function evaluateDatabaseTrace(expectation, calls) {
  if (!Array.isArray(calls)) return false;
  const writes = calls.filter(
    (call) =>
      [
        "proposeDatabaseCells",
        "editPageText",
        "patchNode",
        "insertNode",
        "deleteNode",
      ].includes(call.name) || call.writeClass === "write",
  );
  if (expectation.tool !== "proposeDatabaseCells" && writes.length)
    return false;
  const call = calls.findLast((item) => item.name === expectation.tool);
  if (!call || call.arguments?.databaseId !== expectation.databaseId)
    return false;
  if (expectation.pageIds) {
    const actual = call.observedSelectionPageIds;
    if (
      call.observedSelectionComplete !== true ||
      !Array.isArray(actual) ||
      new Set(actual).size !== actual.length ||
      JSON.stringify([...actual].sort()) !==
        JSON.stringify([...expectation.pageIds].sort())
    )
      return false;
  }
  if (expectation.rows) {
    const canonical = (rows) =>
      JSON.stringify(
        rows
          .map((row) => ({
            pageId: row.pageId,
            cells: row.cells
              .map(({ propertyId, value, expectedRevision }) => ({
                propertyId,
                value,
                expectedRevision,
              }))
              .sort((a, b) => a.propertyId.localeCompare(b.propertyId)),
          }))
          .sort((a, b) => a.pageId.localeCompare(b.pageId)),
      );
    try {
      return (
        writes.length === 1 &&
        canonical(call.arguments.rows) === canonical(expectation.rows)
      );
    } catch {
      return false;
    }
  }
  return Object.entries(expectation.result).every(([key, expected]) => {
    const actual = key
      .split(".")
      .reduce((value, part) => value?.[part], call.result);
    return JSON.stringify(actual) === JSON.stringify(expected);
  });
}
