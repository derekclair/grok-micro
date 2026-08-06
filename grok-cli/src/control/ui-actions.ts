export type ConversationScrollDirection = "up" | "down" | "bottom";

export interface ConversationScrollTarget {
  scrollBy(delta: number): void;
}

export function reasoningDirectionDelta(direction: "increase" | "decrease"): -1 | 1 {
  return direction === "increase" ? 1 : -1;
}

export function applyConversationScroll(
  target: ConversationScrollTarget | null,
  direction: ConversationScrollDirection,
  scrollToBottom: () => void,
): boolean {
  if (!target) return false;
  if (direction === "bottom") scrollToBottom();
  else target.scrollBy(direction === "up" ? -160 : 160);
  return true;
}
