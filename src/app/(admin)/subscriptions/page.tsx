import { Placeholder } from "../_placeholder/placeholder";
import { requirePagePermission } from "@/lib/auth/session";

export const metadata = { title: "Abonnements" };

export default async function Page() {
  await requirePagePermission("subscriptions:read");
  return <Placeholder title="Abonnements" spec="§7.3" needs="Liste paginée de subscriptions avec filtres statut/plan/échéance. L'ajustement passera par POST /admin/v1/subscriptions/{uid}/adjustments (à créer côté backend)." />;
}
