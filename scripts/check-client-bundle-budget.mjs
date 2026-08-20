import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultManifestPath = join(
  root,
  "apps",
  "client",
  "dist",
  ".vite",
  "manifest.json",
);

export const CLIENT_BUNDLE_BUDGET = Object.freeze({
  generalMaxRawBytes: 1_500_000,
  initialClosureMaxGzipBytes: 260_000,
  pageRouteClosureMaxGzipBytes: 900_000,
  excalidrawSubset: Object.freeze({
    maxRawBytes: 1_821_659,
    maxGzipBytes: 736_669,
  }),
});

const excalidrawEditorSource =
  "src/features/editor/components/excalidraw/excalidraw-editor.tsx";
const excalidrawViewSource =
  "src/features/editor/components/excalidraw/excalidraw-view.tsx";
const pageRouteSource = "src/pages/page/page.tsx";
const requiredDynamicSources = [
  "src/features/comment/components/page-comment-section.tsx",
  "src/features/ai/components/ai-document-context-sync.tsx",
  "src/features/editor/components/math/math-inline.tsx",
  "src/features/editor/components/math/math-block.tsx",
  "src/features/editor/components/image/image-view.tsx",
  "src/features/editor/components/video/video-view.tsx",
  "src/features/editor/components/audio/audio-view.tsx",
  "src/features/editor/components/attachment/attachment-view.tsx",
  "src/features/editor/components/code-block/code-block-view.tsx",
  "src/features/editor/components/drawio/drawio-view.tsx",
  "src/features/editor/components/excalidraw/excalidraw-view.tsx",
  "src/features/editor/components/embed/embed-view.tsx",
  "src/features/editor/components/link-preview/link-preview-view.tsx",
  "src/features/editor/components/pdf/pdf-view.tsx",
  "src/features/editor/components/subpages/subpages-view.tsx",
  "src/features/editor/components/page-template/template-node-views.tsx",
  excalidrawEditorSource,
];
const subsetSharedSourcePattern =
  /\/node_modules\/@excalidraw\/excalidraw\/dist\/(?:dev|prod)\/subset-shared\.chunk\.js$/u;
const subsetWorkerSourcePattern =
  /\/node_modules\/@excalidraw\/excalidraw\/dist\/(?:dev|prod)\/subset-worker\.chunk\.js$/u;

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function staticImportClosure(manifest, entryKey) {
  const visited = new Set();
  const pending = [entryKey];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const imported of manifest[current]?.imports ?? []) {
      pending.push(imported);
    }
  }
  return visited;
}

function getClosureMetrics(manifest, assetMetrics, entryKey) {
  const closure = staticImportClosure(manifest, entryKey);
  const files = new Set(
    [...closure]
      .map((key) => normalizePath(manifest[key]?.file ?? ""))
      .filter((file) => file.endsWith(".js")),
  );
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const metrics = assetMetrics.get(file);
    if (!metrics) continue;
    rawBytes += metrics.rawBytes;
    gzipBytes += metrics.gzipBytes;
  }

  return { closure, files, rawBytes, gzipBytes };
}

function reverseImporters(manifest, targetKey) {
  const importers = [];
  for (const [key, entry] of Object.entries(manifest)) {
    if ((entry.imports ?? []).includes(targetKey)) {
      importers.push({ key, entry, kind: "static" });
    }
    if ((entry.dynamicImports ?? []).includes(targetKey)) {
      importers.push({ key, entry, kind: "dynamic" });
    }
  }
  return importers;
}

function isExcalidrawMainImporter(importer) {
  return (
    importer.kind === "dynamic" &&
    importer.entry.isDynamicEntry === true &&
    /^percentages-[A-Za-z0-9_-]+$/u.test(importer.entry.name ?? "") &&
    /^assets\/percentages-[A-Za-z0-9_-]+\.js$/u.test(
      normalizePath(importer.entry.file),
    )
  );
}

function isExcalidrawEditorImporter(importer) {
  return (
    importer.kind === "dynamic" &&
    normalizePath(importer.key) === excalidrawViewSource &&
    importer.entry.name === "excalidraw-view"
  );
}

function findManifestEntry(manifest, source) {
  if (manifest[source]) {
    return { key: source, entry: manifest[source] };
  }

  const expectedName = source.split("/").at(-1)?.replace(/\.tsx?$/u, "");
  const matches = Object.entries(manifest).filter(
    ([, entry]) =>
      normalizePath(entry.src ?? "") === source || entry.name === expectedName,
  );
  return matches.length === 1
    ? { key: matches[0][0], entry: matches[0][1] }
    : null;
}

function isSubsetWorkerImporter(importer) {
  return (
    importer.kind === "static" &&
    subsetWorkerSourcePattern.test(normalizePath(importer.key)) &&
    importer.entry.isDynamicEntry === true
  );
}

export function validateClientBundleBudget({
  manifest,
  assetMetrics,
  budget = CLIENT_BUNDLE_BUDGET,
}) {
  const errors = [];
  const entries = Object.entries(manifest);
  const subsetEntries = entries.filter(([key]) =>
    subsetSharedSourcePattern.test(normalizePath(key)),
  );
  if (subsetEntries.length !== 1) {
    errors.push(
      `Expected exactly one Excalidraw subset-shared chunk, found ${subsetEntries.length}.`,
    );
  }

  const editorEntries = entries.filter(
    ([key]) => normalizePath(key) === excalidrawEditorSource,
  );
  if (editorEntries.length !== 1) {
    errors.push(
      `Expected exactly one Excalidraw editor dynamic entry, found ${editorEntries.length}.`,
    );
  }

  const initialMetrics = getClosureMetrics(
    manifest,
    assetMetrics,
    "index.html",
  );
  const initialClosure = initialMetrics.closure;
  if (initialMetrics.gzipBytes > budget.initialClosureMaxGzipBytes) {
    errors.push(
      `Initial static closure gzip cap exceeded: ${initialMetrics.gzipBytes} > ${budget.initialClosureMaxGzipBytes}.`,
    );
  }

  const pageRouteEntry = manifest[pageRouteSource];
  const pageRouteMetrics = pageRouteEntry
    ? getClosureMetrics(manifest, assetMetrics, pageRouteSource)
    : null;
  if (!pageRouteMetrics) {
    errors.push(`Missing page route manifest entry: ${pageRouteSource}.`);
  } else if (
    pageRouteMetrics.gzipBytes > budget.pageRouteClosureMaxGzipBytes
  ) {
    errors.push(
      `Page route static closure gzip cap exceeded: ${pageRouteMetrics.gzipBytes} > ${budget.pageRouteClosureMaxGzipBytes}.`,
    );
  }

  for (const source of requiredDynamicSources) {
    const match = findManifestEntry(manifest, source);
    if (!match) {
      errors.push(`Missing required dynamic entry: ${source}.`);
      continue;
    }
    const { key, entry } = match;
    if (entry.isDynamicEntry !== true) {
      errors.push(`Required lazy component became eager: ${source}.`);
    }
    if (pageRouteMetrics?.closure.has(key)) {
      errors.push(
        `Required lazy component entered the page route static closure: ${source}.`,
      );
    }
  }
  const [subsetEntry] = subsetEntries;
  const [editorEntry] = editorEntries;
  if (subsetEntry && initialClosure.has(subsetEntry[0])) {
    errors.push("Excalidraw subset-shared must not be reachable from initial static imports.");
  }
  let editorImporters = [];
  if (editorEntry) {
    if (editorEntry[1].isDynamicEntry !== true) {
      errors.push("Excalidraw editor must remain a dynamic entry.");
    }
    if (initialClosure.has(editorEntry[0])) {
      errors.push("Excalidraw editor must not be reachable from initial static imports.");
    }
    editorImporters = reverseImporters(manifest, editorEntry[0]);
    if (
      editorImporters.length !== 1 ||
      editorImporters.filter(isExcalidrawEditorImporter).length !== 1
    ) {
      const actual = editorImporters
        .map(
          (importer) =>
            `${importer.kind}:${normalizePath(importer.key)}:${importer.entry.name ?? "unnamed"}`,
        )
        .sort()
        .join(", ");
      errors.push(
        `Excalidraw editor importer contract drifted: ${actual || "no importers"}.`,
      );
    }
    for (const importer of editorImporters) {
      if (initialClosure.has(importer.key)) {
        errors.push(
          `Excalidraw editor importer must remain outside initial static imports: ${normalizePath(importer.key)}.`,
        );
      }
    }
  }

  const uniqueJavaScriptFiles = new Set(
    entries
      .map(([, entry]) => normalizePath(entry.file))
      .filter((file) => file.endsWith(".js")),
  );
  const subsetFile = subsetEntry
    ? normalizePath(subsetEntry[1].file)
    : undefined;
  for (const file of uniqueJavaScriptFiles) {
    const metrics = assetMetrics.get(file);
    if (!metrics) {
      errors.push(`Missing bundle metrics for ${file}.`);
      continue;
    }
    if (file !== subsetFile && metrics.rawBytes > budget.generalMaxRawBytes) {
      errors.push(
        `General bundle cap exceeded by ${file}: ${metrics.rawBytes} > ${budget.generalMaxRawBytes} raw bytes.`,
      );
    }
  }

  let subsetMetrics;
  let subsetImporters = [];
  if (subsetEntry) {
    if (subsetEntry[1].isDynamicEntry !== true) {
      errors.push("Excalidraw subset-shared must remain a dynamic entry.");
    }
    subsetMetrics = assetMetrics.get(subsetFile);
    if (!subsetMetrics) {
      errors.push(`Missing bundle metrics for ${subsetFile}.`);
    } else {
      if (subsetMetrics.rawBytes > budget.excalidrawSubset.maxRawBytes) {
        errors.push(
          `Excalidraw subset raw cap exceeded: ${subsetMetrics.rawBytes} > ${budget.excalidrawSubset.maxRawBytes}.`,
        );
      }
      if (subsetMetrics.gzipBytes > budget.excalidrawSubset.maxGzipBytes) {
        errors.push(
          `Excalidraw subset gzip cap exceeded: ${subsetMetrics.gzipBytes} > ${budget.excalidrawSubset.maxGzipBytes}.`,
        );
      }
    }

    subsetImporters = reverseImporters(manifest, subsetEntry[0]);
    if (
      subsetImporters.length !== 2 ||
      subsetImporters.filter(isExcalidrawMainImporter).length !== 1 ||
      subsetImporters.filter(isSubsetWorkerImporter).length !== 1
    ) {
      const actual = subsetImporters
        .map(
          (importer) =>
            `${importer.kind}:${normalizePath(importer.key)}:${importer.entry.name ?? "unnamed"}`,
        )
        .sort()
        .join(", ");
      errors.push(
        `Excalidraw subset importer contract drifted: ${actual || "no importers"}.`,
      );
    }
    for (const importer of subsetImporters) {
      if (initialClosure.has(importer.key)) {
        errors.push(
          `Excalidraw subset importer must remain outside initial static imports: ${normalizePath(importer.key)}.`,
        );
      }
    }
  }

  return {
    errors,
    report: {
      javascriptChunks: uniqueJavaScriptFiles.size,
      initialClosure: {
        files: initialMetrics.files.size,
        rawBytes: initialMetrics.rawBytes,
        gzipBytes: initialMetrics.gzipBytes,
      },
      pageRouteClosure: pageRouteMetrics
        ? {
            files: pageRouteMetrics.files.size,
            rawBytes: pageRouteMetrics.rawBytes,
            gzipBytes: pageRouteMetrics.gzipBytes,
          }
        : undefined,
      subsetFile,
      subsetMetrics,
      editorImporters: editorImporters.map((importer) => ({
        kind: importer.kind,
        key: normalizePath(importer.key),
        name: importer.entry.name,
      })),
      subsetImporters: subsetImporters.map((importer) => ({
        kind: importer.kind,
        key: normalizePath(importer.key),
        name: importer.entry.name,
      })),
    },
  };
}

async function collectAssetMetrics(manifest, manifestPath) {
  const distDirectory = resolve(dirname(manifestPath), "..");
  const files = new Set(
    Object.values(manifest)
      .map((entry) => normalizePath(entry.file))
      .filter((file) => file.endsWith(".js")),
  );
  const metrics = new Map();
  await Promise.all(
    [...files].map(async (file) => {
      const content = await readFile(join(distDirectory, ...file.split("/")));
      metrics.set(file, {
        rawBytes: content.byteLength,
        gzipBytes: gzipSync(content, { level: 9 }).byteLength,
      });
    }),
  );
  return metrics;
}

async function main() {
  const manifestArgument = process.argv.find((argument) =>
    argument.startsWith("--manifest="),
  );
  const manifestPath = resolve(
    manifestArgument?.slice("--manifest=".length) || defaultManifestPath,
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const assetMetrics = await collectAssetMetrics(manifest, manifestPath);
  const { errors, report } = validateClientBundleBudget({
    manifest,
    assetMetrics,
  });
  if (errors.length > 0) {
    throw new Error(`Client bundle budget failed:\n${errors.join("\n")}`);
  }
  console.log(
    `Client bundle budget passed: ${report.javascriptChunks} JavaScript chunks; ` +
      `initial closure ${report.initialClosure.gzipBytes} gzip bytes; ` +
      `page route closure ${report.pageRouteClosure.gzipBytes} gzip bytes; ` +
      `general raw cap ${CLIENT_BUNDLE_BUDGET.generalMaxRawBytes}; ` +
      `Excalidraw subset ${report.subsetMetrics.rawBytes} raw / ` +
      `${report.subsetMetrics.gzipBytes} gzip bytes.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
