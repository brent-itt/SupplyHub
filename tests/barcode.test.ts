import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, MultiFormatOneDReader } from "@zxing/library";
import { normalizeBarcode } from "../src/lib/barcode";
import { barcodeSVG } from "../src/lib/barcode-image";

test("barcode lookup preserves leading zeroes and rejects links and control characters", () => {
  assert.equal(normalizeBarcode("  0012345678905\r\n"), "0012345678905");
  assert.equal(normalizeBarcode("sup-001_a.b"), "SUP-001_A.B");
  for (const code of ["", "https://example.com", "javascript:alert(1)", "SUP\n001", "a".repeat(81)]) assert.equal(normalizeBarcode(code), null);
});

test("printed Code 128 labels decode back to the exact stock code", async () => {
  for (const code of ["SUP-001", "0012345678905", "PAPER_A.4", "A".repeat(80)]) {
    const { data, info } = await sharp(Buffer.from(barcodeSVG(code))).flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
    assert.equal(new MultiFormatOneDReader().decode(bitmap).getText(), code);
  }
});
