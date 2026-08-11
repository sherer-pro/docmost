import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

const appModule = read("apps/server/src/app.module.ts");
const collabAppModule = read(
  "apps/server/src/collaboration/server/collab-app.module.ts",
);
const clientConfig = read("apps/client/src/lib/config.ts");
const rootPackage = JSON.parse(read("package.json"));

assert.doesNotMatch(
  appModule,
  /CollaborationRuntimeModule|collaboration\.module/,
  "The API application must not import the collaboration runtime",
);
assert.match(
  collabAppModule,
  /CollaborationRuntimeModule/,
  "The collaboration application must own the collaboration runtime",
);
assert.doesNotMatch(
  clientConfig,
  /COLLAB_URL[\s\S]{0,200}(APP_URL|getAppUrl\(\))/,
  "The browser collaboration URL must not fall back to the API origin",
);
assert.match(
  rootPackage.scripts.dev,
  /collab:dev/,
  "The development stack must start the dedicated collaboration process",
);

console.log("Collaboration process boundary contract passed.");
