import Image from "next/image";
import { headers } from "next/headers";
import { loadPublicStock } from "@/lib/public-stock";
import { publicStockCategories, stockCategoryQR, stockCategorySite } from "@/lib/stock-category";

export async function PublicStockCategories() {
  const { stocks, error } = await loadPublicStock();
  if (error) return <p className="public-stock-empty" role="status">Supply categories could not be loaded. Please try again shortly.</p>;
  const categories = publicStockCategories(stocks);
  if (!categories.length) return <p className="public-stock-empty">No supplies are currently selected for public display.</p>;
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http";
  const site = stockCategorySite(process.env.NEXT_PUBLIC_SITE_URL, `${protocol}://${requestHeaders.get("host") || "localhost:3000"}`);

  return <div className="public-stock-grid public-category-grid">{categories.map(category => {
    const qr = stockCategoryQR(site, category);
    return <article className="public-stock-card public-category-card" key={category}>
      <div><span className="public-stock-category">Supply category</span><h3>{category}</h3></div>
      <div className="public-category-qr">
        <Image src={qr.image} width={220} height={220} unoptimized alt={`Scan to view ${category} stock`}/>
      </div>
      <p>Scan to check selected supplies and current availability.</p>
    </article>;
  })}</div>;
}
