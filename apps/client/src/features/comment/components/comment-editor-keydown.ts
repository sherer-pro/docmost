export function handleCommentEditorKeydown(
  event: KeyboardEvent,
  onSave?: () => void,
): boolean {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    onSave?.();

    return true;
  }

  return false;
}
