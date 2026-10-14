import bwipjs from "bwip-js/node";

export type PublicStockItem = { id: string; name: string; category: string; unit: string; quantity: number };

export function publicStockCategories(stocks: PublicStockItem[]) {
  return [...new Set(stocks.map(item => item.category))].sort((a, b) => a.localeCompare(b));
}

export function stockCategoryPath(category: string) {
  if (!category.trim() || category.length > 80) throw new Error("Choose a valid supply category.");
  return `/stock?${new URLSearchParams({ category })}`;
}

export function stockCategorySite(configuredSite: string | undefined, requestOrigin: string) {
  if (configuredSite) {
    try {
      const configured = new URL(configuredSite);
      if (["http:", "https:"].includes(configured.protocol) && !configured.username && !configured.password &&
        !["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)) return configured.origin;
    } catch { /* Fall back to the current website if its configured URL is invalid. */ }
  }
  // A localhost development setting must not override a deployed or LAN address.
  return new URL(requestOrigin).origin;
}

export function stockCategoryQR(site: string, category: string) {
  const origin = new URL(site);
  if (!["https:", "http:"].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error("Use an HTTP or HTTPS website address.");
  }
  const path = stockCategoryPath(category);
  const url = new URL(path, origin.origin).href;
  const svg = bwipjs.toSVG({ bcid: "qrcode", text: url, scale: 5, padding: 4, backgroundcolor: "FFFFFF" });
  return { path, url, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
}
