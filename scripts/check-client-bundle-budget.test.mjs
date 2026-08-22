import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_BUNDLE_BUDGET,
  validateClientBundleBudget,
} from "./check-client-bundle-budget.mjs";

const subsetSharedKey =
  "../../node_modules/@excalidraw/excalidraw/dist/dev/subset-shared.chunk.js";
const subsetWorkerKey =
  "../../node_modules/@excalidraw/excalidraw/dist/dev/subset-worker.chunk.js";
const editorKey =
  "src/features/editor/components/excalidraw/excalidraw-editor.tsx";
const layoutKey = "src/components/layouts/global/layout.tsx";
const pageRouteKey = "src/pages/page/page.tsx";
const commentsKey = "src/features/comment/components/page-comment-section.tsx";
const aiContextKey = "src/features/ai/components/ai-document-context-sync.tsx";
const optionalNodeViewKeys = [
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
];

function fixture() {
  const manifest = {
    "index.html": {
      file: "assets/index.js",
      isEntry: true,
      imports: ["_initial.js"],
      dynamicImports: [layoutKey, pageRouteKey, "_page-reading-time-ABC.js"],
    },
    "_initial.js": { file: "assets/initial.js" },
    [layoutKey]: {
      file: "assets/layout.js",
      isDynamicEntry: true,
      imports: ["index.html", "_layout-only.js"],
    },
    "_layout-only.js": { file: "assets/layout-only.js" },
    [pageRouteKey]: {
      file: "assets/page.js",
      isDynamicEntry: true,
      imports: ["index.html", "_page-reading-time-ABC.js", "_deferred-ai.js"],
      dynamicImports: [commentsKey],
    },
    "_deferred-ai.js": {
      file: "assets/deferred-ai.js",
      dynamicImports: [aiContextKey],
    },
    [commentsKey]: {
      file: "assets/comments.js",
      isDynamicEntry: true,
      imports: ["index.html"],
    },
    [aiContextKey]: {
      file: "assets/ai-context.js",
      isDynamicEntry: true,
      imports: ["index.html"],
    },
    "_page-reading-time-ABC.js": {
      file: "assets/page-reading-time-ABC.js",
      name: "page-reading-time",
      isDynamicEntry: true,
    },
    [editorKey]: {
      file: "assets/excalidraw-editor.js",
      isDynamicEntry: true,
      imports: ["_percentages.js"],
    },
    "_percentages.js": {
      file: "assets/percentages-ABC.js",
      name: "percentages-ABC",
      isDynamicEntry: true,
      dynamicImports: [subsetWorkerKey, subsetSharedKey],
    },
    [subsetWorkerKey]: {
      file: "assets/subset-worker.chunk.js",
      isDynamicEntry: true,
      imports: [subsetSharedKey],
    },
    [subsetSharedKey]: {
      file: "assets/subset-shared.chunk.js",
      isDynamicEntry: true,
    },
  };
  const assetMetrics = new Map(
    Object.values(manifest)
      .map((entry) => entry.file)
      .filter((file) => file.endsWith(".js"))
      .map((file) => [file, { rawBytes: 100, gzipBytes: 80 }]),
  );
  for (const [index, key] of optionalNodeViewKeys.entries()) {
    manifest[key] = {
      file: `assets/optional-node-view-${index}.js`,
      isDynamicEntry: true,
      imports: ["index.html"],
      ...(key.endsWith("/excalidraw-view.tsx")
        ? { name: "excalidraw-view", dynamicImports: [editorKey] }
        : {}),
    };
    assetMetrics.set(manifest[key].file, { rawBytes: 100, gzipBytes: 80 });
  }
  assetMetrics.set("assets/subset-shared.chunk.js", {
    rawBytes: CLIENT_BUNDLE_BUDGET.excalidrawSubset.maxRawBytes,
    gzipBytes: CLIENT_BUNDLE_BUDGET.excalidrawSubset.maxGzipBytes,
  });
  return { manifest, assetMetrics };
}

test("accepts the bounded lazy Excalidraw graph", () => {
  const result = validateClientBundleBudget(fixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.report.javascriptChunks, 27);
  assert.equal(result.report.initialClosure.gzipBytes, 160);
  assert.equal(result.report.pageRoute.layoutClosure.gzipBytes, 320);
  assert.equal(result.report.pageRoute.leafClosure.gzipBytes, 400);
  assert.equal(result.report.pageRoute.matchedClosure.gzipBytes, 560);
  assert.equal(result.report.pageRoute.incrementalOverInitial.gzipBytes, 400);
});

test("rejects general and Excalidraw budget growth", () => {
  const generalGrowth = fixture();
  generalGrowth.assetMetrics.set("assets/page-reading-time-ABC.js", {
    rawBytes: CLIENT_BUNDLE_BUDGET.generalMaxRawBytes + 1,
    gzipBytes: 100,
  });
  assert.match(
    validateClientBundleBudget(generalGrowth).errors.join("\n"),
    /General bundle cap exceeded/u,
  );

  const subsetGrowth = fixture();
  subsetGrowth.assetMetrics.set("assets/subset-shared.chunk.js", {
    rawBytes: CLIENT_BUNDLE_BUDGET.excalidrawSubset.maxRawBytes + 1,
    gzipBytes: CLIENT_BUNDLE_BUDGET.excalidrawSubset.maxGzipBytes + 1,
  });
  const errors = validateClientBundleBudget(subsetGrowth).errors.join("\n");
  assert.match(errors, /Excalidraw subset raw cap exceeded/u);
  assert.match(errors, /Excalidraw subset gzip cap exceeded/u);
});

test("rejects initial and page route closure growth", () => {
  const initialGrowth = fixture();
  initialGrowth.assetMetrics.set("assets/index.js", {
    rawBytes: 100,
    gzipBytes: CLIENT_BUNDLE_BUDGET.initialClosureMaxGzipBytes,
  });
  assert.match(
    validateClientBundleBudget(initialGrowth).errors.join("\n"),
    /Initial static closure gzip cap exceeded/u,
  );

  const pageGrowth = fixture();
  pageGrowth.assetMetrics.set("assets/page.js", {
    rawBytes: 100,
    gzipBytes: CLIENT_BUNDLE_BUDGET.pageRouteIncrementalMaxGzipBytes,
  });
  assert.match(
    validateClientBundleBudget(pageGrowth).errors.join("\n"),
    /Matched page route incremental gzip cap exceeded/u,
  );

  const layoutGrowth = fixture();
  layoutGrowth.assetMetrics.set("assets/layout-only.js", {
    rawBytes: 100,
    gzipBytes: CLIENT_BUNDLE_BUDGET.pageRouteIncrementalMaxGzipBytes,
  });
  assert.match(
    validateClientBundleBudget(layoutGrowth).errors.join("\n"),
    /Matched page route incremental gzip cap exceeded/u,
  );

  const initialCssGrowth = fixture();
  initialCssGrowth.manifest["index.html"].css = ["assets/index.css"];
  initialCssGrowth.assetMetrics.set("assets/index.css", {
    rawBytes: 100,
    gzipBytes: CLIENT_BUNDLE_BUDGET.initialClosureMaxCssGzipBytes + 1,
  });
  assert.match(
    validateClientBundleBudget(initialCssGrowth).errors.join("\n"),
    /Initial static closure CSS gzip cap exceeded/u,
  );

  const pageCssGrowth = fixture();
  pageCssGrowth.manifest[layoutKey].css = ["assets/layout.css"];
  pageCssGrowth.assetMetrics.set("assets/layout.css", {
    rawBytes: 100,
    gzipBytes: CLIENT_BUNDLE_BUDGET.pageRouteIncrementalMaxCssGzipBytes + 1,
  });
  assert.match(
    validateClientBundleBudget(pageCssGrowth).errors.join("\n"),
    /Matched page route incremental CSS gzip cap exceeded/u,
  );

  const generalCssGrowth = fixture();
  generalCssGrowth.manifest[layoutKey].css = ["assets/layout.css"];
  generalCssGrowth.assetMetrics.set("assets/layout.css", {
    rawBytes: CLIENT_BUNDLE_BUDGET.generalMaxCssRawBytes + 1,
    gzipBytes: 100,
  });
  assert.match(
    validateClientBundleBudget(generalCssGrowth).errors.join("\n"),
    /General CSS bundle cap exceeded/u,
  );
});

test("does not resolve required sources by basename alone", () => {
  const renamed = fixture();
  const layout = renamed.manifest[layoutKey];
  delete renamed.manifest[layoutKey];
  renamed.manifest["_unrelated-layout.js"] = {
    ...layout,
    name: "layout",
    src: "src/unrelated/layout.tsx",
  };

  assert.match(
    validateClientBundleBudget(renamed).errors.join("\n"),
    /Missing global layout manifest entry/u,
  );
});

test("rejects comments, AI context, or optional editor views becoming eager", () => {
  const eagerComments = fixture();
  eagerComments.manifest[pageRouteKey].imports.push(commentsKey);
  eagerComments.manifest[commentsKey].isDynamicEntry = false;
  const errors = validateClientBundleBudget(eagerComments).errors.join("\n");
  assert.match(errors, /Required lazy component became eager/u);
  assert.match(errors, /entered the page route static closure/u);
});

test("rejects new allowlisted chunks and importer drift", () => {
  const duplicate = fixture();
  duplicate.manifest[
    "../../node_modules/@excalidraw/excalidraw/dist/prod/subset-shared.chunk.js"
  ] = {
    file: "assets/second-subset-shared.chunk.js",
    isDynamicEntry: true,
  };
  duplicate.assetMetrics.set("assets/second-subset-shared.chunk.js", {
    rawBytes: 100,
    gzipBytes: 80,
  });
  assert.match(
    validateClientBundleBudget(duplicate).errors.join("\n"),
    /exactly one Excalidraw subset-shared chunk/u,
  );

  const drifted = fixture();
  drifted.manifest["_unexpected.js"] = {
    file: "assets/unexpected.js",
    imports: [subsetSharedKey],
  };
  drifted.assetMetrics.set("assets/unexpected.js", {
    rawBytes: 100,
    gzipBytes: 80,
  });
  assert.match(
    validateClientBundleBudget(drifted).errors.join("\n"),
    /subset importer contract drifted/u,
  );

  const editorDrift = fixture();
  editorDrift.manifest["_unexpected-editor-importer.js"] = {
    file: "assets/unexpected-editor-importer.js",
    dynamicImports: [editorKey],
  };
  editorDrift.assetMetrics.set("assets/unexpected-editor-importer.js", {
    rawBytes: 100,
    gzipBytes: 80,
  });
  assert.match(
    validateClientBundleBudget(editorDrift).errors.join("\n"),
    /editor importer contract drifted/u,
  );
});

test("rejects Excalidraw payloads that become initial or eager", () => {
  const initialSubset = fixture();
  initialSubset.manifest["_initial.js"].imports = [subsetSharedKey];
  assert.match(
    validateClientBundleBudget(initialSubset).errors.join("\n"),
    /subset-shared must not be reachable from initial static imports/u,
  );

  const initialSubsetImporter = fixture();
  initialSubsetImporter.manifest["_initial.js"].imports = ["_percentages.js"];
  assert.match(
    validateClientBundleBudget(initialSubsetImporter).errors.join("\n"),
    /subset importer must remain outside initial static imports/u,
  );

  const eagerEditor = fixture();
  eagerEditor.manifest["index.html"].imports.push(editorKey);
  eagerEditor.manifest[editorKey].isDynamicEntry = false;
  const errors = validateClientBundleBudget(eagerEditor).errors.join("\n");
  assert.match(errors, /editor must remain a dynamic entry/u);
  assert.match(
    errors,
    /editor must not be reachable from initial static imports/u,
  );
});
