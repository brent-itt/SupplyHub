import { StockOutPOS } from "@/components/stock-out-pos";
import { PageHeading, ErrorNotice } from "@/components/system/ui";
import Link from "next/link";
import { z } from "zod";
import type { StudentCheckoutLog } from "@/lib/student-stock-out";
import { requireProfile } from "@/lib/auth";
import { universityDate } from "@/lib/requisitions";
import type { Item } from "@/lib/types";

export default async function ScanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireProfile(["staff", "admin", "super_admin"], "/scan");
  const params = await searchParams;
  let studentLog: StudentCheckoutLog | undefined;
  if (params.student_log !== undefined) {
    const id = z.string().uuid().safeParse(params.student_log);
    const result = id.success ? await supabase.from("student_stock_out_logs").select("id,student_name,receipt_date,receipt_number,item_id,item_name,quantity,unit,status").eq("id", id.data).maybeSingle<StudentCheckoutLog>() : null;
    if (!result?.data || result.error) return <><ErrorNotice message="This student submission could not be loaded. Open it again from the student log."/><Link className="sys-button" href="/student-logs">Back to student logs</Link></>;
    studentLog = result.data;
  }
  const items: Item[] = [];
  // Supabase limits each response; page through the catalog so every barcode resolves.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("items").select("*").eq("is_archived", false).order("id").range(from, from + 999);
    if (error) throw new Error("Unable to load supplies for barcode checkout.");
    items.push(...(data as Item[]));
    if (data.length < 1000) break;
  }
  return <>
    <PageHeading eyebrow="SUPPLIES COUNTER" title="Barcode stock out" description={studentLog ? "Student details are filled in. Scan the requested item's barcode, then confirm to complete this student stock out." : "Scan supplies, review quantities, and issue stock directly. No requisition or approval is needed."} actions={studentLog && <Link className="sys-button sys-button-secondary" href="/student-logs">Back to student logs</Link>}/>
    <StockOutPOS key={studentLog?.id ?? "direct"} items={items} defaultDate={universityDate()} studentLog={studentLog}/>
  </>;
}
