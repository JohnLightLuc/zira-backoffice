/** Display formats (README du design system) : dates JJ/MM/AAAA HH:mm en UTC, montants FCFA. */
const TZ = "UTC";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = fmtDate(iso);
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${date} ${time} UTC`;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-FR").format(n);
}

export function fmtXof(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${fmtNumber(n)} FCFA`;
}

export function minutesSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, (now - new Date(iso).getTime()) / 60000);
}

export function fmtAge(minutes: number | null): string {
  if (minutes == null) return "jamais";
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${Math.round(minutes)} min`;
  if (minutes < 60 * 48) return `il y a ${Math.round(minutes / 60)} h`;
  return `il y a ${Math.round(minutes / 1440)} j`;
}

export function fmtDelta(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const value = `${pct >= 0 ? "+" : ""}${pct.toFixed(1).replace(".", ",")} %`;
  return { value, direction: pct >= 0 ? ("up" as const) : ("down" as const), pct };
}

export function newRequestId(): string {
  return "req_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
