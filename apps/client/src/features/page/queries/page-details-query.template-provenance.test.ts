import { describe, expect, it } from "vitest";
import { getTemplateProvenancePollingInterval } from "./page-details-query";
import type {
  PageTemplateProvenance,
  TemplateInstanceStatus,
} from "@/features/page-template/types/page-template.types";

function provenance(status: TemplateInstanceStatus): PageTemplateProvenance {
  return {
    createdFromTemplate: true,
    kind: "synced",
    status,
    provenanceState: "restricted",
    sourceTemplate: null,
    canReadTemplate: false,
    canDetach: false,
    canCreateIndependentCopy: false,
    appliedRevision: null,
    latestRevision: null,
    lastErrorCode: null,
  };
}

describe("template provenance polling", () => {
  it("polls synchronization quickly and terminal linked states infrequently", () => {
    expect(getTemplateProvenancePollingInterval(provenance("syncing"))).toBe(
      2_500,
    );
    expect(getTemplateProvenancePollingInterval(provenance("active"))).toBe(
      30_000,
    );
    expect(getTemplateProvenancePollingInterval(provenance("error"))).toBe(
      30_000,
    );
    expect(getTemplateProvenancePollingInterval(provenance("detached"))).toBe(
      false,
    );
    expect(getTemplateProvenancePollingInterval(undefined)).toBe(false);
  });
});
