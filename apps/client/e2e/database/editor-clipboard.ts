import type { Locator } from "@playwright/test";

// Exercise the editor's clipboard handlers without replacing the host clipboard.
export async function editorClipboard(
  editor: Locator,
  kind: "copy" | "paste",
  payload: Record<string, string> = {},
): Promise<Record<string, string>> {
  return editor.evaluate(
    (element, input) => {
      const transfer = new DataTransfer();
      for (const [mime, value] of Object.entries(input.payload))
        transfer.setData(mime, value);
      const event = new ClipboardEvent(input.kind, {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      });
      if (event.clipboardData !== transfer)
        Object.defineProperty(event, "clipboardData", { value: transfer });
      element.dispatchEvent(event);
      return Object.fromEntries(
        ["text/html", "text/plain"].map((mime) => [
          mime,
          transfer.getData(mime),
        ]),
      );
    },
    { kind, payload },
  );
}
