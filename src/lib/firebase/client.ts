"use client";

import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

/**
 * Browser Firebase: used ONLY to sign staff in and keep the ID token fresh; the token is
 * stored in an HttpOnly cookie by /api/session. The browser never reads Firestore, never
 * calls the admin API nor Traccar (BACKOFFICE_API.md §1).
 */
// Read statically so Next.js inlines the NEXT_PUBLIC_* values in the browser bundle.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** False when the public Firebase Web config is missing (e.g. no .env.local): login is impossible. */
export const firebaseWebConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);

export class FirebaseNotConfiguredError extends Error {
  constructor() {
    super("Connexion indisponible : configuration Firebase Web absente (NEXT_PUBLIC_FIREBASE_API_KEY, _AUTH_DOMAIN, _PROJECT_ID).");
  }
}

export function clientAuth() {
  if (!firebaseWebConfigured) throw new FirebaseNotConfiguredError();
  const app =
    getApps()[0] ??
    initializeApp(config);
  return getAuth(app);
}
