"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onIdTokenChanged } from "firebase/auth";
import { clientAuth, firebaseWebConfigured } from "@/lib/firebase/client";

/**
 * Keeps the HttpOnly `__session` cookie in step with the Firebase ID token (BACKOFFICE_API.md §2.2).
 * The SDK refreshes the token before it expires (1 h); each new token is posted to /api/session.
 * A refused token (revoked, role removed) sends the operator back to /login.
 * Mounted once in the protected layout; does nothing in demo mode.
 */
export function SessionSync({ demo }: { demo: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (demo || !firebaseWebConfigured) return;
    const auth = clientAuth();
    let last: string | null = null;
    const post = async (idToken: string) => {
      if (idToken === last) return;
      last = idToken;
      const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) }).catch(() => null);
      if (res && (res.status === 401 || res.status === 403)) {
        await auth.signOut().catch(() => {});
        router.replace("/login?reason=session_revoked");
      }
    };
    const off = onIdTokenChanged(auth, (user) => {
      if (user) user.getIdToken().then(post).catch(() => {});
    });
    // After sleep / a long background tab, force the SDK to check expiry.
    const onVisible = () => {
      if (document.visibilityState === "visible") auth.currentUser?.getIdToken().then(post).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [demo, router]);
  return null;
}
