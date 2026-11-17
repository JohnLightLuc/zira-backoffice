import "server-only";
import { db } from "@/lib/firebase/admin";
import { isDemo } from "@/lib/env";
import { DEMO_PLANS } from "@/lib/data/demo-store";

export interface PlanOption { id: string; name: string }

/** plans/ — read only (no plan editing in the MVP, BACKOFFICE_API.md §6). Feeds the adjustment form. */
export async function getPlans(): Promise<PlanOption[]> {
  if (isDemo()) return Object.keys(DEMO_PLANS).map((id) => ({ id, name: id }));
  const snap = await db().collection("plans").select("name").get();
  return snap.docs.map((d) => ({ id: d.id, name: typeof d.get("name") === "string" ? d.get("name") : d.id })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
