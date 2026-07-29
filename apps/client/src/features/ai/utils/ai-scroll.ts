export const AI_CHAT_BOTTOM_THRESHOLD = 80;

export function isAiChatNearBottom(input: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  threshold?: number;
}): boolean {
  const distance = input.scrollHeight - input.scrollTop - input.clientHeight;
  return distance <= (input.threshold ?? AI_CHAT_BOTTOM_THRESHOLD);
}
