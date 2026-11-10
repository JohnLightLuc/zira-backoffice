"use client";

import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

/**
 * Browser Firebase: used ONLY to sign staff in and obtain an ID token,
 * which is exchanged for an HttpOnly session cookie. The browser never reads
 * Firestore or calls Traccar directly (spec §3).
 */
export function clientAuth() {
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  return getAuth(app);
}
