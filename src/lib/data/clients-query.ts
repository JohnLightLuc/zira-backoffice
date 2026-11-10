import { z } from "zod";
import { SUB_STATUSES, type ClientRow, type Page } from "@/lib/data/types";

/** Query params of the clients list, validated from the URL (filters persist in the URL, spec §4). */
export const clientsQuerySchema = z.object({
  q: z.string().trim().max(80).optional().default(""),
  plan: z.string().trim().max(40).optional().default(""),
  sub: z.enum(SUB_STATUSES).optional().catch(undefined),
  sort: z.enum(["name", "vehicles", "lastSignIn", "createdAt"]).catch("name").default("name"),
  dir: z.enum(["asc", "desc"]).catch("asc").default("asc"),
  cursor: z.string().max(400).optional(),
  size: z.coerce.number().int().min(10).max(100).catch(25).default(25),
});
export type ClientsQuery = z.infer<typeof clientsQuerySchema>;

/** Opaque cursor: [sortValue, uid] encoded in base64url. */
export function encodeCursor(value: unknown, uid: string): string {
  return Buffer.from(JSON.stringify([value, uid])).toString("base64url");
}
export function decodeCursor(cursor: string | undefined): [unknown, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(v) && v.length === 2 && typeof v[1] === "string" ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

export function normalise(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Search tokens stored on admin_client_index: name words/prefixes, email, phone digits, uid. */
export function searchTokens(c: Pick<ClientRow, "uid" | "name" | "email" | "phone">): string[] {
  const out = new Set<string>();
  for (const word of normalise(c.name).split(/[^a-z0-9]+/).filter(Boolean)) {
    for (let i = 2; i <= Math.min(word.length, 15); i++) out.add(word.slice(0, i));
  }
  if (c.email) out.add(normalise(c.email));
  const digits = (c.phone ?? "").replace(/\D/g, "");
  if (digits.length >= 6) {
    out.add(digits);
    out.add(digits.slice(-8));
  }
  out.add(c.uid.toLowerCase());
  return [...out];
}

export function sortValue(c: ClientRow, sort: ClientsQuery["sort"]): string | number {
  switch (sort) {
    case "vehicles": return c.vehicleCount ?? -1;
    case "lastSignIn": return c.lastSignInAt ?? "";
    case "createdAt": return c.createdAt ?? "";
    default: return normalise(c.name);
  }
}

/** In-memory implementation of the same query — used for demo data and tests. */
export function queryClientsInMemory(rows: ClientRow[], q: ClientsQuery): Page<ClientRow> {
  const term = normalise(q.q);
  let list = rows.filter((c) => {
    if (q.plan && c.plan !== q.plan) return false;
    if (q.sub && c.subStatus !== q.sub) return false;
    if (term && !searchTokens(c).some((t) => t.startsWith(term) || t === term)) return false;
    return true;
  });
  const dir = q.dir === "asc" ? 1 : -1;
  list = list.sort((a, b) => {
    const va = sortValue(a, q.sort), vb = sortValue(b, q.sort);
    const r = va < vb ? -1 : va > vb ? 1 : a.uid.localeCompare(b.uid);
    return r * dir;
  });
  const after = decodeCursor(q.cursor);
  if (after) {
    const idx = list.findIndex((c) => c.uid === after[1]);
    list = idx >= 0 ? list.slice(idx + 1) : list;
  }
  const items = list.slice(0, q.size);
  const hasMore = list.length > q.size;
  const last = items[items.length - 1];
  return { items, hasMore, nextCursor: hasMore && last ? encodeCursor(sortValue(last, q.sort), last.uid) : null };
}
