import { describe, expect, it } from "vitest";
import {
  getAuthenticationAssuranceReadError,
  isAuthenticationAssuranceMutationError,
} from "./api-client.ts";

const assuranceError = (
  method: string,
  status = 428,
  code = "AUTHENTICATION_ASSURANCE_REQUIRED",
) => ({
  config: { method },
  response: { status, data: { code } },
});

describe("isAuthenticationAssuranceMutationError", () => {
  it.each(["post", "put", "patch", "delete"])(
    "identifies %s assurance failures",
    (method) => {
      expect(
        isAuthenticationAssuranceMutationError(assuranceError(method)),
      ).toBe(true);
    },
  );

  it.each(["get", "head", "options"])(
    "does not notify for background %s requests",
    (method) => {
      expect(
        isAuthenticationAssuranceMutationError(assuranceError(method)),
      ).toBe(false);
      expect(getAuthenticationAssuranceReadError(assuranceError(method))).toMatchObject({
        code: "AUTHENTICATION_ASSURANCE_REQUIRED",
      });
    },
  );

  it("ignores unrelated failures", () => {
    expect(
      isAuthenticationAssuranceMutationError(assuranceError("post", 403)),
    ).toBe(false);
    expect(
      isAuthenticationAssuranceMutationError(
        assuranceError("post", 428, "OTHER_PRECONDITION"),
      ),
    ).toBe(false);
  });

  it.each(["post", "put", "patch", "delete"])(
    "does not route mutation %s failures through a page boundary",
    (method) => {
      expect(getAuthenticationAssuranceReadError(assuranceError(method))).toBeNull();
    },
  );
});
