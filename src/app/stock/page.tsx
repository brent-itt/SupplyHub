import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PublicHeader } from "@/components/system/shell";
import { PublicStock } from "@/components/public-stock";

export const metadata: Metadata = { title: "Stock by category | SupplyHub" };

export default async function CategoryStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { category } = await searchParams;
  if (typeof category !== "string" || !category.trim() || category.length > 80) redirect("/#available-stock");

  return <div className="sys-public-page public-category-page">
    <PublicHeader/>
    <main className="public-stock-section">
      <div className="public-category-navigation"><Link className="sys-link" href="/#available-stock">← All categories</Link><Link className="sys-button sys-button-secondary" href="/form">Student stock-out form</Link></div>
      <div className="public-stock-heading">
        <p className="public-stock-eyebrow">PUBLIC STOCK AVAILABILITY</p>
        <h1>{category}</h1>
        <p>Supplies selected by the Supplies Office in this category, with their current availability.</p>
      </div>
      <Suspense key={category} fallback={<p className="public-stock-empty" role="status">Loading current stock availability…</p>}><PublicStock category={category}/></Suspense>
    </main>
  </div>;
}
