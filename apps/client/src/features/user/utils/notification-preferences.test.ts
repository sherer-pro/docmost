import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  normalizeEmailFrequency,
  normalizePreferenceBoolean,
  normalizePushFrequency,
} from "./notification-preferences";

describe("notification-preferences", () => {
  it("normalizes string booleans", () => {
    assert.equal(normalizePreferenceBoolean("false", true), false);
    assert.equal(normalizePreferenceBoolean("\"true\"", false), true);
    assert.equal(normalizePreferenceBoolean("invalid", true), true);
  });

  it("normalizes quoted push frequency values", () => {
    assert.equal(normalizePushFrequency("\"24h\"", "immediate"), "24h");
    assert.equal(normalizePushFrequency("\"1H\"", "immediate"), "1h");
    assert.equal(normalizePushFrequency("invalid", "3h"), "3h");
  });

  it("normalizes quoted email frequency values", () => {
    assert.equal(normalizeEmailFrequency("\"6h\"", "immediate"), "6h");
    assert.equal(normalizeEmailFrequency("\"IMMEDIATE\"", "1h"), "immediate");
    assert.equal(normalizeEmailFrequency("invalid", "24h"), "24h");
  });
});
