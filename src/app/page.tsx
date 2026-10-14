import LandingPage from "@/components/landing-page";
import { Suspense } from "react";
import { PublicStockCategories } from "@/components/public-stock-categories";

export default function Home() {
  return <LandingPage stockContent={<Suspense fallback={<p className="public-stock-empty" role="status">Loading supply categories…</p>}><PublicStockCategories/></Suspense>}/>;
}
