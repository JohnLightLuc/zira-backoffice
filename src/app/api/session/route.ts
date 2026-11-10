import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/lib/firebase/admin";
import { env, isDemo } from "@/lib/env";
import { isStaffRole } from "@/lib/auth/rbac";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Exchanges a fresh Firebase ID token for an HttpOnly session cookie (spec §8).
 * - only accounts carrying a `staffRole` custom claim are accepted (provisioned manually);
 * - MFA is required unless ZIRA_REQUIRE_MFA=false (staging only);
 * - same-origin check against CSRF; the token must be recent (fresh sign-in).
 */
export const runtime = "nodejs";

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return origin !== null && origin === req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  if (isDemo()) return NextResponse.json({ code: "DEMO", message: "Mode démo : pas de session réelle." }, { status: 400 });
  if (!sameOrigin(req)) return NextResponse.json({ code: "CSRF", message: "Origine refusée" }, { status: 403 });

  const body = z.object({ idToken: z.string().min(20).max(4096) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ code: "BAD_REQUEST", message: "Requête invalide" }, { status: 400 });

  try {
    const decoded = await adminAuth().verifyIdToken(body.data.idToken, true);
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) {
      return NextResponse.json({ code: "STALE_LOGIN", message: "Reconnectez-vous." }, { status: 401 });
    }
    if (!isStaffRole(decoded.staffRole)) {
      return NextResponse.json({ code: "NOT_STAFF", message: "Ce compte n'a pas accès au backoffice." }, { status: 403 });
    }
    if (env().ZIRA_REQUIRE_MFA && !decoded.firebase.sign_in_second_factor) {
      return NextResponse.json({ code: "MFA_REQUIRED", message: "La double authentification est obligatoire pour le personnel." }, { status: 403 });
    }
    const expiresIn = env().SESSION_DAYS * 24 * 3600 * 1000;
    const cookie = await adminAuth().createSessionCookie(body.data.idToken, { expiresIn });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: expiresIn / 1000 });
    return res;
  } catch {
    return NextResponse.json({ code: "UNAUTHENTICATED", message: "Connexion refusée." }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ code: "CSRF", message: "Origine refusée" }, { status: 403 });
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token && !isDemo()) {
    // revoke refresh tokens so the session cookie cannot be reused elsewhere
    await adminAuth().verifySessionCookie(token).then((d) => adminAuth().revokeRefreshTokens(d.sub)).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
