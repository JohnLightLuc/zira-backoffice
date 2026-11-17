"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMultiFactorResolver, PhoneAuthProvider, PhoneMultiFactorGenerator, RecaptchaVerifier,
  onAuthStateChanged, signInWithEmailAndPassword, signOut, type MultiFactorError, type MultiFactorResolver,
} from "firebase/auth";
import { clientAuth, firebaseWebConfigured } from "@/lib/firebase/client";
import { Alert, Button } from "@/components/ui";

/**
 * Email + password, then the second factor (SMS) required for staff.
 * The ID token is posted to /api/session, which stores it in an HttpOnly cookie. The Firebase
 * client session stays signed in so that the SDK refreshes the ID token (1 h) and
 * <SessionSync> re-posts it (BACKOFFICE_API.md §2.2). Refused accounts are signed out.
 * When the Firebase session survived but the cookie expired, the cookie is restored silently.
 */
export function LoginForm({ notice }: { notice?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState<{ resolver: MultiFactorResolver; verificationId: string } | null>(null);
  const [error, setError] = useState<string | null>(notice ?? null);
  const configured = firebaseWebConfigured;
  const [busy, setBusy] = useState(false);

  async function exchange(idToken: string) {
    const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
    if (!res.ok) {
      await signOut(clientAuth());
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message ?? "Connexion refusée.");
    }
    router.replace("/");
    router.refresh();
  }

  // Silent restore: Firebase still signed in (cookie expired). A revoked account fails the forced
  // refresh or the server check and is signed out.
  useEffect(() => {
    if (!firebaseWebConfigured) return;
    const auth = clientAuth();
    const off = onAuthStateChanged(auth, (user) => {
      off();
      if (!user) return;
      user.getIdToken(true).then(exchange).catch(() => signOut(auth));
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mfa) {
        const cred = PhoneAuthProvider.credential(mfa.verificationId, code.trim());
        const result = await mfa.resolver.resolveSignIn(PhoneMultiFactorGenerator.assertion(cred));
        await exchange(await result.user.getIdToken());
        return;
      }
      const auth = clientAuth();
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await exchange(await cred.user.getIdToken());
      } catch (err) {
        if ((err as { code?: string }).code !== "auth/multi-factor-auth-required") throw err;
        const resolver = getMultiFactorResolver(auth, err as MultiFactorError);
        const hint = resolver.hints[0];
        if (!hint) throw new Error("Aucun second facteur enregistré pour ce compte.");
        const verifier = new RecaptchaVerifier(auth, "recaptcha", { size: "invisible" });
        const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber({ multiFactorHint: hint, session: resolver.session }, verifier);
        setMfa({ resolver, verificationId });
      }
    } catch (err) {
      const c = (err as { code?: string }).code;
      setError(c === "auth/invalid-credential" || c === "auth/wrong-password" ? "E-mail ou mot de passe incorrect." : err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
      {!mfa ? (
        <>
          <div className="zr-field">
            <label htmlFor="email">E-mail professionnel</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="zr-field">
            <label htmlFor="password">Mot de passe</label>
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="zr-field">
          <label htmlFor="code">Code reçu par SMS</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
          <span className="zr-field__help">Second facteur obligatoire pour les comptes du personnel.</span>
        </div>
      )}
      {!configured && (
        <Alert tone="warning" title="Firebase Web non configuré">
          Renseignez NEXT_PUBLIC_FIREBASE_API_KEY, _AUTH_DOMAIN et _PROJECT_ID dans .env.local (même projet que le backend), puis redémarrez le serveur. Pour explorer sans Firebase : ZIRA_DEMO_MODE=true.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" variant="primary" disabled={busy || !configured}>{busy ? "Connexion…" : mfa ? "Valider le code" : "Se connecter"}</Button>
      <div id="recaptcha" />
    </form>
  );
}
