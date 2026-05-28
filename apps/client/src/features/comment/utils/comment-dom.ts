function escapeCssValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

export function getCommentMarkSelector(commentId: string): string {
  return `.comment-mark[data-comment-id="${escapeCssValue(commentId)}"]`;
}

export function scrollCommentMarkIntoView(
  commentId: string,
): HTMLElement | null {
  const element = document.querySelector(getCommentMarkSelector(commentId));

  if (!(element instanceof HTMLElement)) {
    return null;
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  return element;
}
