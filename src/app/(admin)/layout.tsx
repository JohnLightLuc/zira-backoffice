import { AppShell } from "@/components/app-shell";
import { requireStaff } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getDeviceCounts } from "@/lib/data/devices";
import { SessionSync } from "@/components/session-sync";
import { orNull } from "@/lib/data/safe";

// Staff pages are always rendered per request: data is global and access is per role.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const counts = await orNull(getDeviceCounts(30));
  return (
    <AppShell staff={staff} env={env().NEXT_PUBLIC_ZIRA_ENV} counts={{ devices: counts?.silent ?? 0 }}>
      <SessionSync demo={staff.demo} />
      {children}
    </AppShell>
  );
}
