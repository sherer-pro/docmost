import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDictionaryImportConfirmModal } from "./dictionary-import-confirmation";

const { openConfirmModalMock } = vi.hoisted(() => ({
  openConfirmModalMock: vi.fn(),
}));

vi.mock("@mantine/modals", () => ({
  modals: {
    openConfirmModal: openConfirmModalMock,
  },
}));

function t(
  key: string,
  options?: Record<string, string | number | boolean>,
): string {
  if (!options) {
    return key;
  }

  return `${key} ${JSON.stringify(options)}`;
}

describe("openDictionaryImportConfirmModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a confirmation modal without importing immediately", () => {
    const importMock = vi.fn();

    openDictionaryImportConfirmModal({
      fileName: "dictionary.json",
      termCount: 3,
      t,
      onConfirm: importMock,
    });

    expect(importMock).not.toHaveBeenCalled();
    expect(openConfirmModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Import dictionary terms",
        labels: {
          confirm: "Import",
          cancel: "Cancel",
        },
        onConfirm: importMock,
      }),
    );
  });

  it("imports only after confirmation", () => {
    const importMock = vi.fn();

    openDictionaryImportConfirmModal({
      fileName: "dictionary.json",
      termCount: 3,
      t,
      onConfirm: importMock,
    });

    const modalConfig = openConfirmModalMock.mock.calls[0][0];
    modalConfig.onConfirm();

    expect(importMock).toHaveBeenCalledTimes(1);
  });

  it("does not import when the confirmation is cancelled", () => {
    const importMock = vi.fn();

    openDictionaryImportConfirmModal({
      fileName: "dictionary.json",
      termCount: 3,
      t,
      onConfirm: importMock,
    });

    expect(importMock).not.toHaveBeenCalled();
  });
});
