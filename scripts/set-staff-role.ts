/**
 * Manual staff provisioning (spec §5: invitation only, no public sign-up).
 *
 *   npx tsx scripts/set-staff-role.ts agent@zira.ci support
 *   npx tsx scripts/set-staff-role.ts agent@zira.ci none      # revoke
 *
 * Sets the `staffRole` custom claim and revokes refresh tokens so the change applies
 * at the next sign-in. Run by a super_admin with project credentials, never from the app.
 * Enrol the account in MFA (SMS) before first use: /api/session refuses staff without it.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { STAFF_ROLES } from "../src/lib/auth/rbac";

const [email, role] = process.argv.slice(2);
if (!email || !role || (role !== "none" && !(STAFF_ROLES as readonly string[]).includes(role))) {
  console.error(`Usage : set-staff-role.ts <email> <${STAFF_ROLES.join("|")}|none>`);
  process.exit(1);
}

const auth = getAuth(initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID }));

(async () => {
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims ?? {}) };
  if (role === "none") delete claims.staffRole;
  else claims.staffRole = role;
  await auth.setCustomUserClaims(user.uid, claims);
  await auth.revokeRefreshTokens(user.uid);
  console.log(`${email} (${user.uid}) → staffRole = ${role}. MFA inscrit : ${user.multiFactor?.enrolledFactors.length ? "oui" : "NON"}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
