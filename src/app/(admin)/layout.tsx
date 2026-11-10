import { AppShell } from "@/components/app-shell";
import { requireStaff } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getDeviceCounts } from "@/lib/data/devices";

// Staff pages are always rendered per request: data is global and access is per role.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const counts = await getDeviceCounts(30, staff).catch(() => null);
  return (
    <AppShell staff={staff} env={env().NEXT_PUBLIC_ZIRA_ENV} counts={{ devices: counts?.silent ?? 0 }}>
      {children}
    </AppShell>
  );
}
