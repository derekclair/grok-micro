import assert from "node:assert/strict";
import test from "node:test";
import { CODEX_MICRO_PRODUCT_ID, CREATOR_MICRO_V2_PRODUCT_IDS, VENDOR_USAGE_PAGE, WORK_LOUDER_VENDOR_ID } from "codex-micro-protocol";
import type { Device } from "node-hid";
import { modelForDescriptor, sortCodexMicroCandidates, transportForDescriptor } from "../src/micro";

function device(productId: number, transport: "usb" | "bluetooth", release = 1): Device {
  return {
    vendorId: WORK_LOUDER_VENDOR_ID,
    productId,
    usagePage: VENDOR_USAGE_PAGE,
    path: `${transport}-${productId}`,
    release,
    interface: 1,
    transport,
  } as Device;
}

test("candidate order is USB Codex, USB Creator, BLE Codex, BLE Creator", () => {
  const candidates = [
    device(CREATOR_MICRO_V2_PRODUCT_IDS[0], "bluetooth"),
    device(CODEX_MICRO_PRODUCT_ID, "bluetooth"),
    device(CREATOR_MICRO_V2_PRODUCT_IDS[1], "usb"),
    device(CODEX_MICRO_PRODUCT_ID, "usb"),
  ];
  assert.deepEqual(sortCodexMicroCandidates(candidates).map((entry) => [transportForDescriptor(entry), modelForDescriptor(entry)]), [
    ["usb", "codex-micro"],
    ["usb", "creator-micro-v2"],
    ["bluetooth", "codex-micro"],
    ["bluetooth", "creator-micro-v2"],
  ]);
});

test("transport uses explicit metadata, then safe descriptor markers", () => {
  assert.equal(transportForDescriptor(device(CODEX_MICRO_PRODUCT_ID, "usb")), "usb");
  const marker = { ...device(CODEX_MICRO_PRODUCT_ID, "usb"), transport: "unknown", path: "Bluetooth-123" } as Device;
  assert.equal(transportForDescriptor(marker), "bluetooth");
  const unknown = { ...device(CODEX_MICRO_PRODUCT_ID, "usb"), transport: "unknown", path: "IOService:123" } as Device;
  assert.equal(transportForDescriptor(unknown), "unknown");
});
