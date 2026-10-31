import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { requiredString, zodResolver } from "./zod-resolver";

describe("Zod 4 form compatibility", () => {
  it("validates interface-shaped login values without an index signature", () => {
    interface LoginValues {
      email: string;
      password: string;
    }
    const validate: (values: LoginValues) => Record<string, unknown> =
      zodResolver(
        z.object({
          email: z.string().email("Invalid email"),
          password: z.string().min(8, "Password too short"),
        }),
      );
    expect(
      validate({
        email: "user@example.invalid",
        password: "synthetic-password",
      }),
    ).toEqual({});
    expect(validate({ email: "invalid", password: "short" })).toEqual({
      email: "Invalid email",
      password: "Password too short",
    });
  });

  it("keeps nested issue paths, refinements, and error priority", () => {
    const schema = z
      .object({
        account: z.object({
          code: z.string().min(6, "Too short").regex(/^\d+$/, "Digits only"),
        }),
      })
      .refine((value) => value.account.code !== "000000", {
        path: ["account", "code"],
        message: "Invalid code",
      });
    expect(zodResolver(schema)({ account: { code: "x" } })).toEqual({
      "account.code": "Digits only",
    });
    expect(
      zodResolver(schema, { errorPriority: "first" })({
        account: { code: "x" },
      }),
    ).toEqual({ "account.code": "Too short" });
    expect(zodResolver(schema)({ account: { code: "000000" } })).toEqual({
      "account.code": "Invalid code",
    });
  });

  it("uses the required message only for missing values", () => {
    const schema = requiredString("Current password is required").min(
      8,
      "Too short",
    );
    const missing = schema.safeParse(undefined);
    const wrongType = schema.safeParse(42);
    const short = schema.safeParse("");
    expect(missing.success).toBe(false);
    if (!missing.success)
      expect(missing.error.issues[0].message).toBe(
        "Current password is required",
      );
    expect(wrongType.success).toBe(false);
    if (!wrongType.success)
      expect(wrongType.error.issues[0].message).not.toBe(
        "Current password is required",
      );
    expect(short.success).toBe(false);
    if (!short.success) expect(short.error.issues[0].message).toBe("Too short");
  });
});

describe("CSP-safe form validation", () => {
  it("validates objects without attempting dynamic code compilation", () => {
    const probe = vi.spyOn(globalThis, "Function").mockImplementation(() => {
      throw new EvalError("CSP forbids dynamic code");
    });
    try {
      const validate = zodResolver(
        z.object({ name: z.string().min(2), count: z.number().int() }),
      );
      expect(validate({ name: "Valid", count: 2 })).toEqual({});
      expect(validate({ name: "", count: 2.5 })).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          count: expect.any(String),
        }),
      );
      expect(probe).not.toHaveBeenCalled();
    } finally {
      probe.mockRestore();
    }
  });
});
