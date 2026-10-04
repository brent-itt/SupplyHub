import Image from "next/image";
import { barcodeSVG } from "@/lib/barcode-image";

export function BarcodeLabel({ code, name }: { code: string; name: string }) {
  const svg = barcodeSVG(code);
  const width = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1] ?? 400);
  const height = Number(svg.match(/viewBox="0 0 \d+ (\d+)/)?.[1] ?? 110);
  return <div className="pos-barcode-image"><Image src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`} width={width} height={height} alt={`Barcode for ${name}: ${code}`} unoptimized/></div>;
}
