import assert from "node:assert/strict";
import test from "node:test";
import { CODEX_MICRO_PRODUCT_ID, CREATOR_MICRO_V2_PRODUCT_IDS, VENDOR_USAGE_PAGE, WORK_LOUDER_VENDOR_ID } from "codex-micro-protocol";
import type { Device } from "node-hid";
import { hidBusTransport, hidIdFromUevent, modelForDescriptor, sortCodexMicroCandidates, transportForDescriptor } from "../src/micro";

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

test("Linux HID_ID bus 0003 is USB and 0005 is Bluetooth", () => {
  assert.equal(hidBusTransport("0003:0000303A:00008360"), "usb");
  assert.equal(hidBusTransport("0005:0000303A:00008360"), "bluetooth");
  assert.equal(hidBusTransport("0001:0000303A:00008360"), null);
  assert.equal(hidBusTransport(undefined), null);
});

test("hidraw uevent HID_ID is parsed for Linux transport", () => {
  assert.equal(hidIdFromUevent("HID_NAME=Codex Micro #3\nHID_ID=0005:0000303A:00008360\n"), "0005:0000303A:00008360");
  const linuxBle = {
    ...device(CODEX_MICRO_PRODUCT_ID, "usb"),
    transport: "unknown",
    path: "/dev/hidraw8",
  } as Device;
  assert.equal(
    transportForDescriptor(linuxBle, () => "HID_ID=0005:0000303A:00008360\n"),
    "bluetooth",
  );
  const linuxUsb = { ...linuxBle, path: "/dev/hidraw10" } as Device;
  assert.equal(
    transportForDescriptor(linuxUsb, () => "HID_ID=0003:0000303A:00008360\n"),
    "usb",
  );
});
