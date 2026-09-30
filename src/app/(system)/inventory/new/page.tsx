import Link from "next/link";
import { saveItemAction } from "@/app/actions";
import { ItemForm } from "@/components/system/forms";
import { PageHeading } from "@/components/system/ui";
import { requireProfile } from "@/lib/auth";

export default async function NewInventoryItemPage() {
  await requireProfile(["admin", "super_admin"], "/inventory/new");
  return <>
    <PageHeading eyebrow="INVENTORY" title="Add a supply item" description="Create the item record first, then record an opening stock transaction." actions={<Link className="sys-button sys-button-secondary" href="/inventory">Back to inventory</Link>}/>
    <section className="sys-card" style={{ maxWidth: 850 }}><h2>Supply details</h2><ItemForm action={saveItemAction}/></section>
  </>;
}
