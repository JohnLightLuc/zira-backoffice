import { Placeholder } from "../_placeholder/placeholder";
import { requirePagePermission } from "@/lib/auth/session";

export const metadata = { title: "Santé système" };

export default async function Page() {
  await requirePagePermission("health:read");
  return <Placeholder title="Santé système" spec="§7.6" needs="Nécessite le branchement de Cloud Logging, Error Reporting et Monitoring côté serveur." />;
}
