import { NextResponse, type NextRequest } from "next/server";
import { assertPermission } from "@/lib/auth/session";
import { getClientsPage } from "@/lib/data/clients";
import { clientsQuerySchema } from "@/lib/data/clients-query";
import { writeAudit } from "@/lib/data/audit";
import { newRequestId } from "@/lib/format";
import type { ClientRow } from "@/lib/data/types";

export const runtime = "nodejs";

const MAX_ROWS = 5000;

/** CSV export, role-gated (billing, super_admin) and audited. Only non-secret columns. */
export async function GET(req: NextRequest) {
  const requestId = newRequestId();
  let staff;
  try {
    staff = await assertPermission("clients:export");
  } catch {
    return NextResponse.json({ code: "FORBIDDEN", message: "Export non autorisé pour ce rôle", requestId }, { status: 403 });
  }
  const q = clientsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const rows: ClientRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await getClientsPage({ ...q, size: 100, cursor });
    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < MAX_ROWS);

  const cols: (keyof ClientRow)[] = ["uid", "name", "email", "phone", "plan", "subStatus", "subEndDate", "vehicleCount", "deviceCount", "authDisabled", "emailVerified", "createdAt", "lastSignInAt"];
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV/formula injection guard
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(";"), ...rows.slice(0, MAX_ROWS).map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\n");

  await writeAudit({ staff, action: `Export CSV clients (${rows.length} lignes)`, targetType: "client", targetId: "*", ownerUid: null, result: "read", requestId, reason: JSON.stringify({ q: q.q, plan: q.plan, sub: q.sub }) });

  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zira-clients-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
