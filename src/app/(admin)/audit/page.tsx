import { Placeholder } from "../_placeholder/placeholder";
import { requirePagePermission } from "@/lib/auth/session";

export const metadata = { title: "Journal d'audit" };

export default async function Page() {
  await requirePagePermission("audit:read");
  return <Placeholder title="Journal d'audit" spec="§5" needs="Consultation paginée de admin_audit_logs, filtrable par acteur, action et cible." />;
}
