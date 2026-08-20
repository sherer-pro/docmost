import { describe, expect, it } from "vitest";
import {
  resolveLiveEditorOptions,
  shouldActivateLiveEditor,
} from "./page-editor-lifecycle";

describe("page editor lifecycle", () => {
  it("keeps the readable static editor for slow or offline collaboration", () => {
    expect(
      shouldActivateLiveEditor({
        connectionStatus: "connecting",
        localSynced: true,
        remoteSynced: false,
      }),
    ).toBe(false);
    expect(
      shouldActivateLiveEditor({
        connectionStatus: "disconnected",
        localSynced: true,
        remoteSynced: false,
      }),
    ).toBe(false);
  });

  it("creates live editor options only after local and remote sync", () => {
    const options = { extensions: ["collaboration"] };

    expect(resolveLiveEditorOptions(true, options)).toBeNull();
    expect(
      shouldActivateLiveEditor({
        connectionStatus: "connected",
        localSynced: true,
        remoteSynced: true,
      }),
    ).toBe(true);
    expect(resolveLiveEditorOptions(false, options)).toBe(options);
  });
});
