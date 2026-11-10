/**
 * Builds / refreshes the `admin_client_index` projection used by the clients list, search and dashboard.
 *
 *   npx tsx scripts/backfill-client-index.ts            # dry run: prints counts
 *   npx tsx scripts/backfill-client-index.ts --write    # writes the projection
 *
 * Sources: Firebase Auth (listUsers, paginated), users/{uid}, subscriptions/{uid},
 * counts of vehicles by ownerId. Dates are stored as ISO strings so they can serve as cursors.
 * Never copies traccarPassword, fcmToken or any secret.
 *
 * Keep it fresh afterwards with triggers in functions/ (onDocumentWritten users/{uid},
 * subscriptions/{uid}, vehicles/{id}; beforeUserSignedIn / a daily job for lastSignInAt).
 */
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { searchTokens } from "../src/lib/data/clients-query";

const write = process.argv.includes("--write");
const app = initializeApp({
  credential: process.env.FIREBASE_PRIVATE_KEY
    ? cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") })
    : applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

const toIso = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === "string") return new Date(v).toISOString();
  if (typeof v === "object" && v !== null && "toDate" in v) return (v as { toDate(): Date }).toDate().toISOString();
  return null;
};

function subStatus(x: FirebaseFirestore.DocumentData | undefined): string {
  if (!x) return "free";
  const raw = String(x.status ?? "").toLowerCase();
  const end = toIso(x.endDate);
  if (raw === "active") return end && new Date(end).getTime() - Date.now() < 7 * 864e5 ? "expiring" : "active";
  if (raw === "trial" || raw === "trialing") return "trial";
  if (raw === "expired") return "expired";
  if (raw === "cancelled" || raw === "canceled") return "cancelled";
  return "free";
}

async function main() {
  let pageToken: string | undefined;
  let total = 0;
  do {
    const page = await auth.listUsers(1000, pageToken);
    const refs = page.users.flatMap((u) => [db.doc(`users/${u.uid}`), db.doc(`subscriptions/${u.uid}`)]);
    const snaps = refs.length ? await db.getAll(...refs) : [];
    const batch = db.batch();
    for (let i = 0; i < page.users.length; i++) {
      const u = page.users[i]!;
      const profile = snaps[i * 2]?.data() ?? {};
      const sub = snaps[i * 2 + 1]?.data();
      const vehicles = await db.collection("vehicles").where("ownerId", "==", u.uid).count().get();
      const devices = await db.collection("vehicles").where("ownerId", "==", u.uid).where("deviceId", "!=", null).count().get();
      const name: string = profile.name ?? u.displayName ?? u.email ?? u.uid;
      const row = {
        uid: u.uid,
        name,
        nameLower: name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
        email: u.email ?? profile.email ?? null,
        phone: profile.phoneNumber ?? u.phoneNumber ?? null,
        plan: sub?.planId ?? "Gratuit",
        subStatus: subStatus(sub),
        subEndDate: toIso(sub?.endDate),
        vehicleCount: vehicles.data().count,
        deviceCount: devices.data().count,
        authDisabled: u.disabled,
        emailVerified: u.emailVerified,
        createdAt: new Date(u.metadata.creationTime).toISOString(),
        lastSignInAt: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
        updatedAt: new Date().toISOString(),
      };
      const tokens = searchTokens({ uid: row.uid, name: row.name, email: row.email, phone: row.phone });
      if (write) batch.set(db.doc(`admin_client_index/${u.uid}`), { ...row, searchTokens: tokens });
    }
    if (write) await batch.commit();
    total += page.users.length;
    console.log(`${total} comptes traités${write ? "" : " (dry run)"}`);
    pageToken = page.pageToken;
  } while (pageToken);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
