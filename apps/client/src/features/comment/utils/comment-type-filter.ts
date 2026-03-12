import { IComment } from "@/features/comment/types/comment.types";

export function isPageLevelComment(comment: IComment): boolean {
  return comment.type === "page";
}

export function isInlineOrLegacyComment(comment: IComment): boolean {
  return comment.type !== "page";
}
