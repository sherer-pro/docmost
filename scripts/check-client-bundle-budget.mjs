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
  generalMaxCssRawBytes: 300_000,
  initialClosureMaxGzipBytes: 260_000,
  initialClosureMaxCssGzipBytes: 40_000,
  pageRouteIncrementalMaxGzipBytes: 900_000,
  pageRouteIncrementalMaxCssGzipBytes: 30_000,
  excalidrawSubset: Object.freeze({
    maxRawBytes: 1_821_659,
    maxGzipBytes: 737_280,
  }),
});

const excalidrawEditorSource =
  "src/features/editor/components/excalidraw/excalidraw-editor.tsx";
const excalidrawViewSource =
  "src/features/editor/components/excalidraw/excalidraw-view.tsx";
const globalLayoutSource = "src/components/layouts/global/layout.tsx";
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

function getMetricsForClosure(manifest, assetMetrics, closure) {
  const files = new Set(
    [...closure]
      .map((key) => normalizePath(manifest[key]?.file ?? ""))
      .filter((file) => file.endsWith(".js")),
  );
  const cssFiles = new Set(
    [...closure].flatMap((key) =>
      (manifest[key]?.css ?? [])
        .map((file) => normalizePath(file))
        .filter((file) => file.endsWith(".css")),
    ),
  );
  let rawBytes = 0;
  let gzipBytes = 0;
  let cssRawBytes = 0;
  let cssGzipBytes = 0;
  for (const file of files) {
    const metrics = assetMetrics.get(file);
    if (!metrics) continue;
    rawBytes += metrics.rawBytes;
    gzipBytes += metrics.gzipBytes;
  }
  for (const file of cssFiles) {
    const metrics = assetMetrics.get(file);
    if (!metrics) continue;
    cssRawBytes += metrics.rawBytes;
    cssGzipBytes += metrics.gzipBytes;
  }

  return {
    closure,
    files,
    cssFiles,
    rawBytes,
    gzipBytes,
    cssRawBytes,
    cssGzipBytes,
  };
}

function getClosureMetrics(manifest, assetMetrics, entryKey) {
  return getMetricsForClosure(
    manifest,
    assetMetrics,
    staticImportClosure(manifest, entryKey),
  );
}

function getMatchedRouteMetrics(
  manifest,
  assetMetrics,
  entryKeys,
  initialClosure,
) {
  const closure = new Set();
  for (const entryKey of entryKeys) {
    for (const key of staticImportClosure(manifest, entryKey)) {
      closure.add(key);
    }
  }
  const incrementalClosure = new Set(
    [...closure].filter((key) => !initialClosure.has(key)),
  );
  return {
    matched: getMetricsForClosure(manifest, assetMetrics, closure),
    incremental: getMetricsForClosure(
      manifest,
      assetMetrics,
      incrementalClosure,
    ),
  };
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

  const matches = Object.entries(manifest).filter(
    ([, entry]) => normalizePath(entry.src ?? "") === source,
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
  if (
    initialMetrics.cssGzipBytes > budget.initialClosureMaxCssGzipBytes
  ) {
    errors.push(
      `Initial static closure CSS gzip cap exceeded: ${initialMetrics.cssGzipBytes} > ${budget.initialClosureMaxCssGzipBytes}.`,
    );
  }

  const layoutRouteMatch = findManifestEntry(manifest, globalLayoutSource);
  const pageRouteMatch = findManifestEntry(manifest, pageRouteSource);
  if (!layoutRouteMatch) {
    errors.push(`Missing global layout manifest entry: ${globalLayoutSource}.`);
  }
  if (!pageRouteMatch) {
    errors.push(`Missing page route manifest entry: ${pageRouteSource}.`);
  }

  const layoutRouteMetrics = layoutRouteMatch
    ? getClosureMetrics(manifest, assetMetrics, layoutRouteMatch.key)
    : null;
  const pageRouteLeafMetrics = pageRouteMatch
    ? getClosureMetrics(manifest, assetMetrics, pageRouteMatch.key)
    : null;
  const matchedPageRouteMetrics =
    layoutRouteMatch && pageRouteMatch
      ? getMatchedRouteMetrics(
          manifest,
          assetMetrics,
          [layoutRouteMatch.key, pageRouteMatch.key],
          initialClosure,
        )
      : null;
  if (
    matchedPageRouteMetrics &&
    matchedPageRouteMetrics.incremental.gzipBytes >
      budget.pageRouteIncrementalMaxGzipBytes
  ) {
    errors.push(
      `Matched page route incremental gzip cap exceeded: ${matchedPageRouteMetrics.incremental.gzipBytes} > ${budget.pageRouteIncrementalMaxGzipBytes}.`,
    );
  }
  if (
    matchedPageRouteMetrics &&
    matchedPageRouteMetrics.incremental.cssGzipBytes >
      budget.pageRouteIncrementalMaxCssGzipBytes
  ) {
    errors.push(
      `Matched page route incremental CSS gzip cap exceeded: ${matchedPageRouteMetrics.incremental.cssGzipBytes} > ${budget.pageRouteIncrementalMaxCssGzipBytes}.`,
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
    if (matchedPageRouteMetrics?.matched.closure.has(key)) {
      errors.push(
        `Required lazy component entered the page route static closure: ${source}.`,
      );
    }
  }
  const [subsetEntry] = subsetEntries;
  const [editorEntry] = editorEntries;
  if (subsetEntry && initialClosure.has(subsetEntry[0])) {
    errors.push(
      "Excalidraw subset-shared must not be reachable from initial static imports.",
    );
  }
  let editorImporters = [];
  if (editorEntry) {
    if (editorEntry[1].isDynamicEntry !== true) {
      errors.push("Excalidraw editor must remain a dynamic entry.");
    }
    if (initialClosure.has(editorEntry[0])) {
      errors.push(
        "Excalidraw editor must not be reachable from initial static imports.",
      );
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
  const uniqueCssFiles = new Set(
    entries.flatMap(([, entry]) =>
      (entry.css ?? [])
        .map((file) => normalizePath(file))
        .filter((file) => file.endsWith(".css")),
    ),
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
  for (const file of uniqueCssFiles) {
    const metrics = assetMetrics.get(file);
    if (!metrics) {
      errors.push(`Missing bundle metrics for ${file}.`);
      continue;
    }
    if (metrics.rawBytes > budget.generalMaxCssRawBytes) {
      errors.push(
        `General CSS bundle cap exceeded by ${file}: ${metrics.rawBytes} > ${budget.generalMaxCssRawBytes} raw bytes.`,
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
      cssAssets: uniqueCssFiles.size,
      initialClosure: {
        files: initialMetrics.files.size,
        cssFiles: initialMetrics.cssFiles.size,
        rawBytes: initialMetrics.rawBytes,
        gzipBytes: initialMetrics.gzipBytes,
        cssRawBytes: initialMetrics.cssRawBytes,
        cssGzipBytes: initialMetrics.cssGzipBytes,
      },
      pageRoute: matchedPageRouteMetrics
        ? {
            matchedSources: [globalLayoutSource, pageRouteSource],
            layoutClosure: {
              files: layoutRouteMetrics.files.size,
              cssFiles: layoutRouteMetrics.cssFiles.size,
              rawBytes: layoutRouteMetrics.rawBytes,
              gzipBytes: layoutRouteMetrics.gzipBytes,
              cssRawBytes: layoutRouteMetrics.cssRawBytes,
              cssGzipBytes: layoutRouteMetrics.cssGzipBytes,
            },
            leafClosure: {
              files: pageRouteLeafMetrics.files.size,
              cssFiles: pageRouteLeafMetrics.cssFiles.size,
              rawBytes: pageRouteLeafMetrics.rawBytes,
              gzipBytes: pageRouteLeafMetrics.gzipBytes,
              cssRawBytes: pageRouteLeafMetrics.cssRawBytes,
              cssGzipBytes: pageRouteLeafMetrics.cssGzipBytes,
            },
            matchedClosure: {
              files: matchedPageRouteMetrics.matched.files.size,
              cssFiles: matchedPageRouteMetrics.matched.cssFiles.size,
              rawBytes: matchedPageRouteMetrics.matched.rawBytes,
              gzipBytes: matchedPageRouteMetrics.matched.gzipBytes,
              cssRawBytes: matchedPageRouteMetrics.matched.cssRawBytes,
              cssGzipBytes: matchedPageRouteMetrics.matched.cssGzipBytes,
            },
            incrementalOverInitial: {
              files: matchedPageRouteMetrics.incremental.files.size,
              cssFiles: matchedPageRouteMetrics.incremental.cssFiles.size,
              rawBytes: matchedPageRouteMetrics.incremental.rawBytes,
              gzipBytes: matchedPageRouteMetrics.incremental.gzipBytes,
              cssRawBytes: matchedPageRouteMetrics.incremental.cssRawBytes,
              cssGzipBytes: matchedPageRouteMetrics.incremental.cssGzipBytes,
            },
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
    Object.values(manifest).flatMap((entry) => [
      ...[normalizePath(entry.file)].filter((file) => file.endsWith(".js")),
      ...(entry.css ?? [])
        .map((file) => normalizePath(file))
        .filter((file) => file.endsWith(".css")),
    ]),
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
    `Client bundle budget passed: ${report.javascriptChunks} JavaScript chunks and ${report.cssAssets} CSS assets; ` +
      `initial closure ${report.initialClosure.gzipBytes} JS / ${report.initialClosure.cssGzipBytes} CSS gzip bytes; ` +
      `matched page route ${report.pageRoute.matchedClosure.gzipBytes} JS / ${report.pageRoute.matchedClosure.cssGzipBytes} CSS gzip bytes ` +
      `(${report.pageRoute.incrementalOverInitial.gzipBytes} JS / ${report.pageRoute.incrementalOverInitial.cssGzipBytes} CSS incremental over initial); ` +
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
