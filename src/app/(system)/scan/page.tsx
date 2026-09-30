import { QRScanner } from "@/components/qr-scanner";
import { PageHeading } from "@/components/system/ui";
import { requireProfile } from "@/lib/auth";

export default async function ScanPage() {
  await requireProfile(["staff", "admin", "super_admin"], "/scan");
  return <>
    <PageHeading eyebrow="INVENTORY" title="Scan a supply QR code" description="Scan a printed item label to view the supply record and current availability."/>
    <QRScanner/>
  </>;
}
