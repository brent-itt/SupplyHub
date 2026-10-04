import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { studentFormQR } from "@/lib/student-form-qr";
import { PageHeading } from "@/components/system/ui";
import { StudentFormQR } from "@/components/student-form-qr";

export default async function StudentFormQRPage() {
  await requireProfile(["staff", "admin", "super_admin"], "/student-logs/qr");
  const qr = studentFormQR(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  return <>
    <PageHeading eyebrow="STUDENT SUBMISSIONS" title="Student form QR code" description="Display this poster at the supplies counter so students can submit their information from a phone."
      actions={<Link className="sys-button sys-button-secondary" href="/student-logs">Back to student logs</Link>}/>
    <StudentFormQR initialURL={qr.url} initialImage={qr.image}/>
  </>;
}
