import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, QRCodeReader } from "@zxing/library";
import { publicStockCategories, stockCategoryPath, stockCategoryQR, stockCategorySite } from "../src/lib/stock-category";

test("QR codes use the published or LAN address instead of a localhost setting", () => {
  assert.equal(stockCategorySite("https://supplies.example/", "https://preview.example"), "https://supplies.example");
  for (const configured of [undefined, "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "invalid", "javascript:alert(1)"]) {
    assert.equal(stockCategorySite(configured, "http://192.168.1.10:3000"), "http://192.168.1.10:3000");
    assert.equal(stockCategorySite(configured, "https://supplies.example"), "https://supplies.example");
  }
});

test("one category card covers multiple selected supplies, including temporarily empty stock", () => {
  const item = { id: "1", name: "Type A", unit: "piece", quantity: 0, category: "Uniform" };
  assert.deepEqual(publicStockCategories([item, { ...item, id: "2", quantity: 10 }, { ...item, id: "3", category: "Paper products" }]), ["Paper products", "Uniform"]);
  assert.deepEqual(publicStockCategories([]), []);
});

test("scannable QR codes and links open the exact category, including special characters", async () => {
  for (const category of ["Uniform", "Office & school / supplies", "Équipements + 紙 #1"]) {
    const qr = stockCategoryQR("https://supplyhub.example/old?query=1", category);
    const { data, info } = await sharp(Buffer.from(qr.image.split(",")[1], "base64")).flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
    const decoded = new URL(new QRCodeReader().decode(bitmap).getText());
    assert.equal(decoded.origin, "https://supplyhub.example");
    assert.equal(decoded.pathname, "/stock");
    assert.equal(decoded.searchParams.get("category"), category);
    assert.equal(decoded.pathname + decoded.search, qr.path);
    assert.equal([...decoded.searchParams].length, 1);
  }
  assert.notEqual(stockCategoryQR("https://supplyhub.example", "Uniform").url, stockCategoryQR("https://supplyhub.example", "Paper products").url);
  for (const category of ["", "  ", "a".repeat(81)]) assert.throws(() => stockCategoryPath(category));
  for (const site of ["javascript:alert(1)", "file:///stock", "https://user:password@example.com"]) assert.throws(() => stockCategoryQR(site, "Uniform"));
});
