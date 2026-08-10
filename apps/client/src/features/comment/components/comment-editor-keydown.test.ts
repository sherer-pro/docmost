import { describe, expect, it, vi } from "vitest";
import { handleCommentEditorKeydown } from "./comment-editor-keydown";

function keyboardEvent(
  key: string,
  options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...options,
  } as unknown as KeyboardEvent;
}

describe("handleCommentEditorKeydown", () => {
  it.each(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"])(
    "lets the suggestion plugin handle %s",
    (key) => {
      const onSave = vi.fn();

      expect(handleCommentEditorKeydown(keyboardEvent(key), onSave)).toBe(
        false,
      );
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it("handles the comment save shortcut", () => {
    const onSave = vi.fn();
    const event = keyboardEvent("Enter", { ctrlKey: true });

    expect(handleCommentEditorKeydown(event, onSave)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });
});
