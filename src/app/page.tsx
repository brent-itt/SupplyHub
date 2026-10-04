import LandingPage from "@/components/landing-page";
import { Suspense } from "react";
import { PublicStock } from "@/components/public-stock";

export default function Home() {
  return <LandingPage stockContent={<Suspense fallback={<p className="public-stock-empty" role="status">Loading current stock availability…</p>}><PublicStock/></Suspense>}/>;
}
