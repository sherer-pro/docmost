import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(root, "package.json"));

test("server editor entrypoint does not load React or browser UI adapters", () => {
  const entrypoint = require.resolve("@docmost/editor-ext/server");
  require(entrypoint);

  const loadedModules = Object.keys(require.cache).map((modulePath) =>
    modulePath.replaceAll("\\", "/").toLowerCase(),
  );

  assert.equal(
    loadedModules.some((modulePath) =>
      /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?react(?:\/|$)/u.test(
        modulePath,
      ),
    ),
    false,
  );
  assert.equal(
    loadedModules.some((modulePath) => modulePath.includes("/@tiptap/react/")),
    false,
  );
  assert.equal(
    loadedModules.some((modulePath) => modulePath.includes("/@floating-ui/")),
    false,
  );
});
