import bwipjs from "bwip-js/node";
import { studentFormURL } from "./student-stock-out";

export function studentFormQR(site: string) {
  const url = studentFormURL(site);
  const svg = bwipjs.toSVG({ bcid: "qrcode", text: url, scale: 5, padding: 4, backgroundcolor: "FFFFFF" });
  return { url, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
}
