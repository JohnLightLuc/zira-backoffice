import { Placeholder } from "../_placeholder/placeholder";
import { requirePagePermission } from "@/lib/auth/session";

export const metadata = { title: "Activité métier" };

export default async function Page() {
  await requirePagePermission("clients:read");
  return <Placeholder title="Activité métier" spec="§7.5" needs="Vues en lecture des véhicules, chauffeurs, affectations et payment_logs, tous clients confondus." />;
}
