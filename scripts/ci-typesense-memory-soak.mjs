import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const PAGE_COUNT = 1_000;
const CONTENT_BYTES = 16 * 1024;
const WARMUP_CYCLES = 2;
const MEASURED_CYCLES = 8;
const MAX_SLOPE_BYTES = 1024 * 1024;
const MAX_FINAL_GROWTH_BYTES = 32 * 1024 * 1024;

if (typeof global.gc !== "function") {
  throw new Error("Typesense memory soak requires node --expose-gc");
}

const compiledModuleUrl = pathToFileURL(
  resolve(
    "apps/server/dist/apps/server/src/core/search/typesense-index.service.js",
  ),
).href;
const {
  TYPESENSE_ATTACHMENT_COLLECTION,
  TYPESENSE_PAGE_COLLECTION,
  TypesenseIndexService,
} = await import(compiledModuleUrl);

const typesenseUrl = process.env.TYPESENSE_URL ?? "http://127.0.0.1:8108";
const typesenseApiKey = process.env.TYPESENSE_API_KEY;
if (!typesenseApiKey) {
  throw new Error("TYPESENSE_API_KEY is required for the memory soak");
}

const content = "x".repeat(CONTENT_BYTES);
const pages = Array.from({ length: PAGE_COUNT }, (_, index) => ({
  id: `memory-page-${String(index).padStart(4, "0")}`,
  workspaceId: "memory-workspace",
  spaceId: "memory-space",
  creatorId: "memory-user",
  title: `Memory page ${index}`,
  textContent: content,
  databaseSearchText: "",
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
}));
const attachments = pages.map((page, index) => ({
  id: `memory-attachment-${String(index).padStart(4, "0")}`,
  workspaceId: page.workspaceId,
  spaceId: page.spaceId,
  pageId: page.id,
  fileName: `memory-${index}.txt`,
  textContent: content,
  updatedAt: page.updatedAt,
}));
const pagesById = new Map(pages.map((page) => [page.id, page]));

class SyntheticQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.maximumRows = Number.POSITIVE_INFINITY;
  }

  innerJoin() {
    return this;
  }

  select() {
    return this;
  }

  orderBy() {
    return this;
  }

  limit(value) {
    this.maximumRows = value;
    return this;
  }

  where(column, operator, value) {
    if (typeof column === "string") {
      this.filters.push({ column, operator, value });
    }
    return this;
  }

  async execute() {
    if (this.table === "pages") {
      const ids = this.filters.find(
        (filter) => filter.column === "pages.id" && filter.operator === "in",
      )?.value;
      return (ids ?? [])
        .map((id) => pagesById.get(id))
        .filter(Boolean)
        .slice(0, this.maximumRows);
    }
    if (this.table === "attachments") {
      const pageIds = new Set(
        this.filters.find(
          (filter) =>
            filter.column === "attachments.pageId" && filter.operator === "in",
        )?.value ?? [],
      );
      const cursor = this.filters.find(
        (filter) =>
          filter.column === "attachments.id" && filter.operator === ">",
      )?.value;
      return attachments
        .filter(
          (attachment) =>
            pageIds.has(attachment.pageId) &&
            (!cursor || attachment.id > cursor),
        )
        .slice(0, this.maximumRows);
    }
    throw new Error(`Unexpected synthetic table ${this.table}`);
  }
}

const db = {
  selectFrom(table) {
    return new SyntheticQuery(table);
  },
};
const environment = {
  getSearchDriver: () => "typesense",
  getTypesenseUrl: () => typesenseUrl,
  getTypesenseApiKey: () => typesenseApiKey,
  getTypesenseLocale: () => "en",
};
const queue = { add: async () => undefined };
const service = new TypesenseIndexService(environment, db, queue);

async function deleteCollection(name) {
  const response = await fetch(
    new URL(`/collections/${encodeURIComponent(name)}`, typesenseUrl),
    {
      method: "DELETE",
      headers: { "x-typesense-api-key": typesenseApiKey },
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Unable to delete Typesense collection ${name}`);
  }
}

async function stabilizeHeap() {
  global.gc();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  global.gc();
}

function linearSlope(values) {
  const xMean = (values.length - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    numerator += (index - xMean) * (values[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  return numerator / denominator;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

try {
  await deleteCollection(TYPESENSE_PAGE_COLLECTION);
  await deleteCollection(TYPESENSE_ATTACHMENT_COLLECTION);

  for (let cycle = 0; cycle < WARMUP_CYCLES; cycle += 1) {
    await service.reconcilePages(pages.map((page) => page.id));
    await stabilizeHeap();
  }

  const measurements = [];
  for (let cycle = 0; cycle < MEASURED_CYCLES; cycle += 1) {
    await service.reconcilePages(pages.map((page) => page.id));
    await stabilizeHeap();
    measurements.push(process.memoryUsage().heapUsed);
  }

  const slopeBytesPerCycle = linearSlope(measurements);
  const earlyPlateauBytes = median(measurements.slice(0, 3));
  const finalGrowthBytes = measurements.at(-1) - earlyPlateauBytes;
  console.log(
    JSON.stringify({
      event: "typesense_memory_soak_completed",
      pageCount: PAGE_COUNT,
      attachmentCount: attachments.length,
      contentBytes: CONTENT_BYTES,
      measuredCycles: MEASURED_CYCLES,
      slopeBytesPerCycle: Math.round(slopeBytesPerCycle),
      finalGrowthBytes,
      maxSlopeBytesPerCycle: MAX_SLOPE_BYTES,
      maxFinalGrowthBytes: MAX_FINAL_GROWTH_BYTES,
    }),
  );
  if (slopeBytesPerCycle > MAX_SLOPE_BYTES) {
    throw new Error("Typesense heap slope exceeded 1 MiB per cycle");
  }
  if (finalGrowthBytes > MAX_FINAL_GROWTH_BYTES) {
    throw new Error("Typesense final heap exceeded the early plateau by 32 MiB");
  }
} finally {
  await service.onModuleDestroy();
  await deleteCollection(TYPESENSE_PAGE_COLLECTION);
  await deleteCollection(TYPESENSE_ATTACHMENT_COLLECTION);
}
