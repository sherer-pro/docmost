import {
  normalizeDatabaseViewState,
  unwrapDatabaseValue,
} from "../../../../packages/api-contract/dist/index.js";

export function createDatabaseFixtureApi() {
  const databaseId = "10000000-0000-4000-8000-000000000001";
  let views, rows, properties, requests, failRows, failNext;
  const reset = () => {
    const types = [
      "multiline_text",
      "number",
      "date",
      "multi_select",
      "url",
      "email",
      "phone",
      "checkbox",
      "select",
    ];
    properties = Array.from({ length: 20 }, (_, index) => ({
      id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name:
        index === 0
          ? "Notes"
          : index === 1
            ? "Amount"
            : index === 2
              ? "Date"
              : index === 3
                ? "Tags"
                : `Field ${index}`,
      type: types[index] ?? "multiline_text",
      position: index,
      settings: [3, 8].includes(index)
        ? {
            options: [
              { value: "a", label: "Alpha" },
              { value: "b", label: "Beta" },
            ],
          }
        : null,
    }));
    rows = Array.from({ length: 1000 }, (_, index) => {
      const pageId = `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      return {
        id: pageId,
        pageId,
        canWrite: index !== 5,
        page: { id: pageId, title: `Row ${index}`, slugId: pageId },
        cells: properties.map((property) => ({
          id: `${pageId}:${property.id}`,
          pageId,
          propertyId: property.id,
          revision: 1,
          value:
            property.type === "number"
              ? index
              : property.type === "date"
                ? { start: "2026-10-13" }
                : property.type === "multi_select"
                  ? ["a", "b"]
                  : property.type === "checkbox"
                    ? false
                    : property.type === "url"
                      ? "https://example.com"
                      : property.type === "email"
                        ? "synthetic@example.com"
                        : property.type === "phone"
                          ? "+1 555 0100"
                          : property.type === "select"
                            ? "a"
                            : `Value ${index}`,
        })),
      };
    });
    views = [
      {
        id: "70000000-0000-4000-8000-000000000001",
        databaseId,
        name: "Shared view",
        type: "table",
        revision: 1,
        config: normalizeDatabaseViewState({}),
      },
    ];
    requests = [];
    failRows = [];
    failNext = false;
  };
  reset();
  const getValue = (row, id) =>
    id === "title"
      ? row.page.title
      : unwrapDatabaseValue(
          row.cells.find((cell) => cell.propertyId === id)?.value,
        );
  const filtered = (state) => {
    const match = (row, condition) => {
      if ("conjunction" in condition)
        return condition.conjunction === "or"
          ? condition.conditions.some((rule) => match(row, rule))
          : condition.conditions.every((rule) => match(row, rule));
      const value = getValue(row, condition.propertyId);
      const candidate = condition.value;
      const text = String(value ?? "").toLowerCase();
      if (condition.operator === "contains")
        return Array.isArray(value)
          ? value.includes(candidate)
          : text.includes(String(candidate).toLowerCase());
      if (condition.operator === "equals") return value === candidate;
      if (condition.operator === "not_equals") return value !== candidate;
      if (condition.operator === "is_empty")
        return (
          value === null ||
          value === "" ||
          (Array.isArray(value) && !value.length)
        );
      if (condition.operator === "gt") return value > candidate;
      if (condition.operator === "lt") return value < candidate;
      return true;
    };
    const result = rows.filter(
      (row) => !state.filter || match(row, state.filter),
    );
    result.sort((left, right) => {
      for (const sort of state.sorts) {
        const a = getValue(left, sort.propertyId);
        const b = getValue(right, sort.propertyId);
        const comparison =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a ?? "").localeCompare(String(b ?? ""));
        if (comparison)
          return sort.direction === "desc" ? -comparison : comparison;
      }
      return left.pageId.localeCompare(right.pageId);
    });
    return result;
  };
  return async (req, res, next) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const reply = (data, status = 200) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data, success: status < 400, status }));
    };
    let body = {};
    if (["POST", "PATCH", "PUT"].includes(req.method)) {
      let text = "";
      for await (const chunk of req) text += chunk;
      body = text ? JSON.parse(text) : {};
    }
    if (url.pathname === "/fixture/reset") {
      reset();
      return reply({});
    }
    if (url.pathname === "/fixture/state")
      return reply({ requests, rows, views });
    if (url.pathname === "/fixture/fail") {
      failRows = body.rows ?? [];
      failNext = Boolean(body.next);
      return reply({});
    }
    requests.push({ method: req.method, path: url.pathname, body });
    if (failNext && !url.pathname.startsWith("/fixture")) {
      failNext = false;
      return reply({}, 503);
    }
    const viewState = normalizeDatabaseViewState(
      url.searchParams.get("viewState")
        ? JSON.parse(url.searchParams.get("viewState"))
        : {},
    );
    if (url.pathname.endsWith("/properties") && req.method === "GET")
      return reply(properties);
    if (url.pathname.endsWith("/views") && req.method === "GET")
      return reply(views);
    if (url.pathname.includes("/views/") && req.method === "PATCH") {
      const view = views.find((item) => url.pathname.endsWith(item.id));
      if (body.expectedRevision !== view.revision) return reply({}, 409);
      Object.assign(view, body, { revision: view.revision + 1 });
      return reply(view);
    }
    if (url.pathname.endsWith("/summary")) {
      const result = filtered(viewState);
      const groups = new Map();
      if (viewState.groupBy)
        for (const row of result) {
          const value = getValue(row, viewState.groupBy);
          for (const key of Array.isArray(value) ? value : [value]) {
            const encoded = JSON.stringify(key ?? null);
            const group = groups.get(encoded) ?? {
              key: encoded,
              label:
                key === "a"
                  ? "Alpha"
                  : key === "b"
                    ? "Beta"
                    : String(key ?? ""),
              count: 0,
              values: {},
            };
            group.count += 1;
            groups.set(encoded, group);
          }
        }
      const values = Object.fromEntries(
        Object.entries(viewState.calculations).map(([id, operation]) => [
          id,
          operation === "sum"
            ? result.reduce(
                (sum, row) => sum + Number(getValue(row, id) ?? 0),
                0,
              )
            : result.length,
        ]),
      );
      return reply({
        count: result.length,
        values,
        groups: [...groups.values()],
      });
    }
    if (url.pathname.endsWith("/rows") && req.method === "GET") {
      let result = filtered(viewState);
      if (url.searchParams.has("groupKey")) {
        const key = JSON.parse(url.searchParams.get("groupKey"));
        result = result.filter((row) => {
          const value = getValue(row, viewState.groupBy);
          return Array.isArray(value) ? value.includes(key) : value === key;
        });
      }
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return reply({
        items: result
          .slice(offset, offset + limit)
          .map((row) => ({
            ...row,
            cells: row.cells.filter((cell) => !cell.deletedAt),
          })),
        hasMore: offset + limit < result.length,
        nextCursor:
          offset + limit < result.length ? String(offset + limit) : null,
      });
    }
    const update = (pageId, operations) => {
      const row = rows.find((row) => row.pageId === pageId);
      if (!row) return null;
      for (const operation of operations) {
        const cell = row.cells.find(
          (cell) => cell.propertyId === operation.propertyId,
        );
        if (
          operation.expectedRevision !== undefined &&
          operation.expectedRevision !==
            (cell?.deletedAt ? 0 : (cell?.revision ?? 0))
        )
          return null;
      }
      const cells = operations.map((operation) => {
        let cell = row.cells.find(
          (cell) => cell.propertyId === operation.propertyId,
        );
        if (!cell) {
          cell = {
            id: `${pageId}:${operation.propertyId}`,
            pageId,
            propertyId: operation.propertyId,
            revision: 0,
          };
          row.cells.push(cell);
        }
        Object.assign(cell, {
          value: operation.operation === "delete" ? null : operation.value,
          revision: cell.revision + 1,
          deletedAt:
            operation.operation === "delete" ? new Date().toISOString() : null,
        });
        return cell;
      });
      return { row: { id: row.id, pageId }, cells };
    };
    if (url.pathname.endsWith("/cells") && req.method === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const pageId = url.pathname.split("/").at(-2);
      if (rows.find((row) => row.pageId === pageId)?.canWrite === false)
        return reply({}, 403);
      const result = update(pageId, body.cells);
      return reply(result ?? {}, result ? 200 : 409);
    }
    if (url.pathname.endsWith("/rows/batch") && req.method === "PATCH") {
      const updatedRows = [],
        deletedRows = [],
        failed = [];
      for (const operation of body.rows) {
        if (failRows.includes(operation.pageId)) {
          failed.push(operation.pageId);
          continue;
        }
        if (operation.operation === "delete_row") {
          rows = rows.filter((row) => row.pageId !== operation.pageId);
          deletedRows.push(operation.pageId);
        } else if (update(operation.pageId, operation.cells))
          updatedRows.push(operation.pageId);
        else failed.push(operation.pageId);
      }
      return reply({ updatedRows, deletedRows, failedRows: failed });
    }
    if (url.pathname.includes("row-context")) return reply(null);
    if (url.pathname.includes("sidebar")) return reply([]);
    if (url.pathname.includes("/spaces") || url.pathname.includes("/users"))
      return reply({ items: [] });
    next();
  };
}
