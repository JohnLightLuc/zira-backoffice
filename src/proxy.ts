import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap first gate: no session cookie → /login. It does NOT verify the cookie;
 * every server page, action and route verifies the session and the role itself
 * (src/lib/auth/session.ts). The proxy is a convenience, never the security boundary.
 */
export function proxy(req: NextRequest) {
  if (process.env.ZIRA_DEMO_MODE === "true") return NextResponse.next();
  if (!req.cookies.has("__session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/session|_next/static|_next/image|brand/|icon.png|favicon.ico).*)"],
};
