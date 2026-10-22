import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, MultiFormatOneDReader } from "@zxing/library";
import { defaultBarcode, normalizeBarcode } from "../src/lib/barcode";
import { barcodeSVG } from "../src/lib/barcode-image";
import { itemSchema } from "../src/lib/validation";

test("new supplies get distinct default codes accepted by inventory and scanners", () => {
  const codes = Array.from({ length: 1000 }, () => defaultBarcode());
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.equal(normalizeBarcode(code), code);
    assert.equal(itemSchema.shape.sku.safeParse(code).success, true);
  }
});

test("barcode lookup preserves leading zeroes and rejects links and control characters", () => {
  assert.equal(normalizeBarcode("  0012345678905\r\n"), "0012345678905");
  assert.equal(normalizeBarcode("sup-001_a.b"), "SUP-001_A.B");
  for (const code of ["", "https://example.com", "javascript:alert(1)", "SUP\n001", "a".repeat(81)]) assert.equal(normalizeBarcode(code), null);
});

test("printed Code 128 labels decode back to the exact stock code", async () => {
  for (const code of [defaultBarcode(), "SUP-001", "0012345678905", "PAPER_A.4", "A".repeat(80)]) {
    const { data, info } = await sharp(Buffer.from(barcodeSVG(code))).flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
    assert.equal(new MultiFormatOneDReader().decode(bitmap).getText(), code);
  }
});
