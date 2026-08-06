import { describe, expect, it, vi } from "vitest";
import { applyConversationScroll, reasoningDirectionDelta } from "./ui-actions";

describe("control UI action mappings", () => {
  it("maps reasoning directions to the existing effort adjustment delta", () => {
    expect(reasoningDirectionDelta("increase")).toBe(1);
    expect(reasoningDirectionDelta("decrease")).toBe(-1);
  });

  it("scrolls the conversation by the existing 160-unit increments", () => {
    const target = { scrollBy: vi.fn() };
    const bottom = vi.fn();

    expect(applyConversationScroll(target, "up", bottom)).toBe(true);
    expect(applyConversationScroll(target, "down", bottom)).toBe(true);
    expect(target.scrollBy).toHaveBeenNthCalledWith(1, -160);
    expect(target.scrollBy).toHaveBeenNthCalledWith(2, 160);
    expect(bottom).not.toHaveBeenCalled();
  });

  it("uses the existing bottom action and fails closed without a conversation", () => {
    const target = { scrollBy: vi.fn() };
    const bottom = vi.fn();

    expect(applyConversationScroll(target, "bottom", bottom)).toBe(true);
    expect(bottom).toHaveBeenCalledOnce();
    expect(target.scrollBy).not.toHaveBeenCalled();
    expect(applyConversationScroll(null, "up", bottom)).toBe(false);
  });
});
