import { Placeholder } from "../_placeholder/placeholder";
import { requirePagePermission } from "@/lib/auth/session";

export const metadata = { title: "Documents" };

export default async function Page() {
  await requirePagePermission("clients:read");
  return <Placeholder title="Documents" spec="§7.5" needs="Documents à expiration. Les fichiers ne s'ouvrent que par lien temporaire généré côté serveur, avec audit." />;
}
