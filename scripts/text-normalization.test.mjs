import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLineEndings } from "./text-normalization.mjs";

test("normalizes CRLF and CR without changing LF content", () => {
  assert.equal(
    normalizeLineEndings("first\r\nsecond\rthird\n"),
    "first\nsecond\nthird\n",
  );
});
