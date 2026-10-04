import LandingPage from "@/components/landing-page";
import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export default async function Home() {
  await connection();
  const config = getSupabaseConfig();
  let stocks: { id: string; name: string; category: string; unit: string; quantity: number }[] = [];

  if (config) {
    const supabase = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.rpc("get_public_stock");
    if (!error && data) stocks = data;
  }

  return <LandingPage stocks={stocks}/>;
}
