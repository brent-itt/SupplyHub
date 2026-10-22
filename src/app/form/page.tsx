import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { PublicHeader } from "@/components/system/shell";
import { StudentStockOutForm } from "@/components/student-stock-out-form";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { universityDate } from "@/lib/requisitions";
import type { StudentFormItem } from "@/lib/student-stock-out";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Student stock-out form | SupplyHub", robots: { index: false, follow: false } };

export default async function StudentFormPage() {
  const admin = createSupabaseAdmin();
  const items: StudentFormItem[] = [];
  let available = !!admin;
  if (admin) {
    const [schemaResult, itemsAvailable] = await Promise.all([
      admin.from("student_stock_out_logs").select("id,student_email,fulfilled_quantity,vip_queued_at").limit(0),
      (async () => {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await admin.from("items").select("id,name,sku,unit").eq("is_archived", false).order("name").order("id").range(from, from + 999);
          if (error) return false;
          items.push(...data);
          if (data.length < 1000) return true;
        }
      })(),
    ]);
    available = !schemaResult.error && itemsAvailable;
  }
  return <div className="sys-public-page student-form-page">
    <PublicHeader/>
    <main className="student-form-card sys-card">
      <p className="sys-eyebrow">PANPACIFIC UNIVERSITY · SUPPLIES OFFICE</p>
      <h1>Student stock-out form</h1>
      <p className="student-form-intro">Collecting supplies? Fill in your details below and show your receipt at the counter. Staff will check your information before issuing your item.</p>
      <ol className="student-form-steps" aria-label="How it works"><li><b>1</b> Fill in</li><li><b>2</b> Staff checks</li><li><b>3</b> Collect item</li></ol>
      {!available && <div className="sys-notice sys-notice-error" role="alert"><p>Student submissions are not available yet. Please contact the Supplies Office.</p></div>}
      {available && !items.length && <div className="sys-notice" role="status"><p>No items are currently listed. Please ask the Supplies Office for help.</p></div>}
      <StudentStockOutForm items={items} defaultDate={universityDate()} submissionId={randomUUID()} available={available && items.length > 0}/>
    </main>
  </div>;
}
