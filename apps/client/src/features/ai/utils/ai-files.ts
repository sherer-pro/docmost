export const AI_CHAT_FILE_ACCEPT = ".pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp";

const AI_CHAT_FILE_EXTENSIONS = new Set(
  AI_CHAT_FILE_ACCEPT.split(",").map((extension) => extension.toLowerCase()),
);

export function isSupportedAiChatFileName(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return false;
  }
  return AI_CHAT_FILE_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase());
}
