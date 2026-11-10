import "server-only";
import { cert, getApps, initializeApp, applicationDefault, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { env } from "@/lib/env";

/**
 * Firebase Admin bypasses Firestore security rules: it is only ever imported by
 * server code, and every caller checks the staff session and role first.
 */
function app(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const e = env();
  if (e.FIREBASE_CLIENT_EMAIL && e.FIREBASE_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        projectId: e.FIREBASE_PROJECT_ID,
        clientEmail: e.FIREBASE_CLIENT_EMAIL,
        privateKey: e.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  }
  // Cloud Run / Functions: application default credentials from the runtime service account.
  return initializeApp({ credential: applicationDefault(), projectId: e.FIREBASE_PROJECT_ID });
}

export const adminAuth = () => getAuth(app());
export const db = () => getFirestore(app());
