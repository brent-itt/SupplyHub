import { StockOutPOS } from "@/components/stock-out-pos";
import { PageHeading, ErrorNotice } from "@/components/system/ui";
import Link from "next/link";
import { z } from "zod";
import type { StudentCheckoutLog } from "@/lib/student-stock-out";
import { requireProfile } from "@/lib/auth";
import { universityDate } from "@/lib/requisitions";
import type { StockOutItem } from "@/lib/types";

export default async function ScanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireProfile(["staff", "admin", "super_admin"], "/scan");
  const params = await searchParams;
  let studentLog: StudentCheckoutLog | undefined;
  if (params.student_log !== undefined) {
    const id = z.string().uuid().safeParse(params.student_log);
    const result = id.success ? await supabase.from("student_stock_out_logs").select("id,student_name,student_email,receipt_date,receipt_number,item_id,item_name,quantity,unit,status,fulfilled_quantity,vip_queued_at").eq("id", id.data).maybeSingle<StudentCheckoutLog>() : null;
    if (!result?.data || result.error) return <><ErrorNotice message="This student submission could not be loaded. Open it again from the student log."/><Link className="sys-button" href="/student-logs">Back to student logs</Link></>;
    studentLog = result.data;
  }
  async function loadItems() {
    const items: StockOutItem[] = [];
    // Supabase limits each response; page through the catalog so every barcode resolves.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("items").select("id,name,sku,unit,quantity,category,low_stock_threshold").eq("is_archived", false).order("id").range(from, from + 999);
      if (error) throw new Error("Unable to load supplies for barcode checkout.");
      items.push(...(data as StockOutItem[]));
      if (data.length < 1000) return items;
    }
  }
  const [{ data: availability, error: availabilityError }, items] = await Promise.all([
    supabase.rpc("student_stock_availability", { p_student_log_id: studentLog?.id ?? null }),
    loadItems(),
  ]);
  if (availabilityError) return <ErrorNotice message={availabilityError.code === "PGRST202" ? "VIP collections need database setup. Apply 202610150001_student_vip_queue.sql in Supabase, then refresh." : "Unable to check VIP stock reservations. Please refresh and try again."}/>;
  const availableQuantities = Object.fromEntries((availability as { item_id: string; available_quantity: number }[]).map(row => [row.item_id, row.available_quantity]));
  return <>
    <PageHeading eyebrow="SUPPLIES COUNTER" title="Barcode stock out" description={studentLog ? "Student details are filled in. Scan the requested item's barcode, then confirm to complete this student stock out." : "Scan supplies, review quantities, and issue stock directly. No requisition or approval is needed."} actions={studentLog && <Link className="sys-button sys-button-secondary" href="/student-logs">Back to student logs</Link>}/>
    <StockOutPOS key={studentLog?.id ?? "direct"} items={items} defaultDate={universityDate()} studentLog={studentLog} availableQuantities={availableQuantities}/>
  </>;
}
