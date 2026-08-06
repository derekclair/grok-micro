// USB identity of the Work Louder Codex Micro's vendor-specific HID interface.
// The device exposes several HID interfaces (keyboard, consumer controls); the
// RPC protocol lives only on the interface with this usage page.

export const WORK_LOUDER_VENDOR_ID = 0x303a;
export const CODEX_MICRO_PRODUCT_ID = 0x8360;
export const CREATOR_MICRO_V2_PRODUCT_IDS = Object.freeze([33431, 33432] as const);
export const VENDOR_USAGE_PAGE = 0xff00;

export type CodexMicroModel = "codex-micro" | "creator-micro-v2";

/**
 * The subset of a HID device descriptor this codec needs. Structurally
 * compatible with node-hid's Device and WebHID's HIDDevice metadata.
 */
export interface HidInterfaceDescriptor {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
}

export function codexMicroModelForProductId(productId: number | undefined): CodexMicroModel | null {
  if (productId === CODEX_MICRO_PRODUCT_ID) return "codex-micro";
  if ((CREATOR_MICRO_V2_PRODUCT_IDS as readonly number[]).includes(productId ?? -1)) return "creator-micro-v2";
  return null;
}

/**
 * Matches a HID device descriptor (as reported by node-hid, WebHID, or any
 * enumerator exposing vendorId/productId/usagePage) against the Codex Micro's
 * vendor RPC interface.
 */
export function isCodexMicroInterface(descriptor: HidInterfaceDescriptor | null | undefined): boolean {
  return (
    descriptor?.vendorId === WORK_LOUDER_VENDOR_ID &&
    codexMicroModelForProductId(descriptor?.productId) !== null &&
    descriptor?.usagePage === VENDOR_USAGE_PAGE
  );
}
