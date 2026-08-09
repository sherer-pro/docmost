import { describe, expect, it } from "vitest";
import {
  isPasswordWithinUtf8Limit,
  MAX_PASSWORD_UTF8_BYTES,
} from "./password-validation";

describe("password UTF-8 validation", () => {
  it("accepts exactly 72 ASCII bytes and rejects 73", () => {
    expect(isPasswordWithinUtf8Limit("a".repeat(MAX_PASSWORD_UTF8_BYTES))).toBe(
      true,
    );
    expect(
      isPasswordWithinUtf8Limit("a".repeat(MAX_PASSWORD_UTF8_BYTES + 1)),
    ).toBe(false);
  });

  it("measures encoded bytes instead of JavaScript characters", () => {
    expect(isPasswordWithinUtf8Limit("é".repeat(36))).toBe(true);
    expect(isPasswordWithinUtf8Limit("é".repeat(37))).toBe(false);
  });
});
