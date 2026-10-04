import bwipjs from "bwip-js/node";

export function barcodeSVG(code: string) {
  return bwipjs.toSVG({ bcid: "code128", text: code, scale: 2, height: 16, paddingwidth: 12, paddingheight: 4, backgroundcolor: "FFFFFF" });
}
