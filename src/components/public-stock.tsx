import { loadPublicStock } from "@/lib/public-stock";
import { formatNumber } from "@/lib/format";

export async function PublicStock({ category }: { category: string }) {
  const { stocks, error } = await loadPublicStock(category);
  if (error) return <p className="public-stock-empty" role="status">Stock availability could not be loaded. Please try again shortly.</p>;
  if (!stocks.length) return <p className="public-stock-empty">No supplies in this category are currently selected for public display.</p>;
  return <div className="public-stock-grid">{stocks.map(item => (
    <article className="public-stock-card" key={item.id}>
      <div><span className="public-stock-category">{item.category}</span><h3>{item.name}</h3></div>
      <div className="public-stock-quantity"><strong>{formatNumber(item.quantity)}</strong><span>{item.unit}{item.quantity === 1 ? "" : "s"} available</span></div>
      <span className={item.quantity > 0 ? "public-stock-status in-stock" : "public-stock-status out-of-stock"}>{item.quantity > 0 ? "In stock" : "Out of stock"}</span>
    </article>
  ))}</div>;
}
