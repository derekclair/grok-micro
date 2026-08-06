import { describe, expect, test } from "bun:test";
import {
  CODEX_MICRO_PRODUCT_ID,
  CREATOR_MICRO_V2_PRODUCT_IDS,
  VENDOR_USAGE_PAGE,
  WORK_LOUDER_VENDOR_ID,
  codexMicroModelForProductId,
  isCodexMicroInterface,
} from "../src/index.js";

describe("isCodexMicroInterface", () => {
  const matching = {
    vendorId: WORK_LOUDER_VENDOR_ID,
    productId: CODEX_MICRO_PRODUCT_ID,
    usagePage: VENDOR_USAGE_PAGE,
  };

  test("matches the vendor RPC interface, including descriptors with extra fields", () => {
    expect(isCodexMicroInterface(matching)).toBe(true);
    const nodeHidStyleDescriptor = { ...matching, path: "/dev/hidraw3", interface: 1 };
    expect(isCodexMicroInterface(nodeHidStyleDescriptor)).toBe(true);
    for (const productId of CREATOR_MICRO_V2_PRODUCT_IDS) {
      expect(isCodexMicroInterface({ ...matching, productId })).toBe(true);
      expect(codexMicroModelForProductId(productId)).toBe("creator-micro-v2");
    }
    expect(codexMicroModelForProductId(CODEX_MICRO_PRODUCT_ID)).toBe("codex-micro");
  });

  test("rejects a mismatch on any single field", () => {
    expect(isCodexMicroInterface({ ...matching, vendorId: 0x1234 })).toBe(false);
    expect(isCodexMicroInterface({ ...matching, productId: 0x1234 })).toBe(false);
    expect(codexMicroModelForProductId(0x1234)).toBe(null);
    expect(isCodexMicroInterface({ ...matching, usagePage: 0x0001 })).toBe(false);
  });

  test("rejects descriptors missing fields, null, and undefined", () => {
    expect(isCodexMicroInterface({})).toBe(false);
    expect(isCodexMicroInterface({ vendorId: WORK_LOUDER_VENDOR_ID })).toBe(false);
    expect(isCodexMicroInterface(null)).toBe(false);
    expect(isCodexMicroInterface(undefined)).toBe(false);
  });
});
