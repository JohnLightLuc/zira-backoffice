import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/lib/firebase/admin";
import { env, isDemo } from "@/lib/env";
import { isStaffRole } from "@/lib/auth/rbac";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";

/**
 * Stores the current Firebase ID token in an HttpOnly cookie (BACKOFFICE_API.md §2.2).
 * The admin API only accepts ID tokens, so the browser re-posts the token each time the
 * Firebase SDK refreshes it (onIdTokenChanged), and the cookie lives as long as the token (1 h).
 * - only accounts carrying a `staffRole` custom claim get a cookie (provisioned manually);
 * - the token is verified with checkRevoked (suspended account / changed role → refused);
 * - MFA is required unless ZIRA_REQUIRE_MFA=false (staging only);
 * - same-origin check against CSRF.
 */
export const runtime = "nodejs";

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return origin !== null && origin === req.nextUrl.origin;
}

function setCookie(res: NextResponse, value: string, maxAge: number) {
  res.cookies.set(SESSION_COOKIE, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge });
}

export async function POST(req: NextRequest) {
  if (isDemo()) return NextResponse.json({ message: "Mode démo : pas de session réelle." }, { status: 400 });
  if (!sameOrigin(req)) return NextResponse.json({ message: "Origine refusée" }, { status: 403 });

  const body = z.object({ idToken: z.string().min(20).max(4096) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ message: "Requête invalide" }, { status: 400 });

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(body.data.idToken, true);
  } catch {
    const res = NextResponse.json({ message: "Session expirée ou révoquée : reconnectez-vous." }, { status: 401 });
    setCookie(res, "", 0);
    return res;
  }
  if (!isStaffRole(decoded.staffRole)) {
    const res = NextResponse.json({ message: "Accès réservé au personnel Zira." }, { status: 403 });
    setCookie(res, "", 0);
    return res;
  }
  if (env().ZIRA_REQUIRE_MFA && !decoded.firebase.sign_in_second_factor) {
    return NextResponse.json({ message: "La double authentification est obligatoire pour le personnel." }, { status: 403 });
  }
  // Cookie never outlives the token it carries.
  const maxAge = Math.max(0, Math.min(SESSION_MAX_AGE, Math.floor(decoded.exp - Date.now() / 1000)));
  const res = new NextResponse(null, { status: 204 });
  setCookie(res, body.data.idToken, maxAge);
  return res;
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Origine refusée" }, { status: 403 });
  const res = new NextResponse(null, { status: 204 });
  setCookie(res, "", 0);
  return res;
}
