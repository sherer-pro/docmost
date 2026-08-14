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

function fixture() {
  const manifest = {
    "index.html": {
      file: "assets/index.js",
      isEntry: true,
      imports: ["_initial.js"],
      dynamicImports: ["_page-reading-time-ABC.js"],
    },
    "_initial.js": { file: "assets/initial.js" },
    "_page-reading-time-ABC.js": {
      file: "assets/page-reading-time-ABC.js",
      name: "page-reading-time",
      isDynamicEntry: true,
      dynamicImports: [editorKey],
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
  assetMetrics.set("assets/subset-shared.chunk.js", {
    rawBytes: CLIENT_BUNDLE_BUDGET.excalidrawSubset.maxRawBytes,
    gzipBytes: CLIENT_BUNDLE_BUDGET.excalidrawSubset.maxGzipBytes,
  });
  return { manifest, assetMetrics };
}

test("accepts the bounded lazy Excalidraw graph", () => {
  const result = validateClientBundleBudget(fixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.report.javascriptChunks, 7);
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
  assert.match(errors, /editor must not be reachable from initial static imports/u);
});
