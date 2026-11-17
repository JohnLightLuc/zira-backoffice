import "server-only";
import type { ClientRow, Subscription } from "@/lib/data/types";
import type { AuditLogEntry, ClientNote, StaffMember } from "@/lib/admin-api/types";

/**
 * Anonymised demo fixtures (spec §12.2), used only when ZIRA_DEMO_MODE=true.
 * They model the backend's sources (Firestore users/vehicles/subscriptions, Traccar devices,
 * admin_audit_logs, admin_client_notes, staff claims) so that the in-memory /admin/v1
 * implementation (src/lib/admin-api/demo-backend.ts) can apply the real contract rules.
 * Mutations live in memory for the lifetime of the server process.
 */
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const day = (d: string) => new Date(d + "T00:00:00Z").toISOString();

export interface DemoClient extends ClientRow {
  userType: string;
  role: string;
  traccarUserId: string | null;
  drivers: number;
  assignments: number;
  documents: number;
  billingCycle: string;
  autoRenew: boolean;
  subStartDate: string | null;
  permissions: Record<string, unknown> | null;
}

const clients: DemoClient[] = [
  { uid: "uid_7Fq2Xa19k9Ze", name: "Kouassi Transport SARL", email: "k.transport@exemple.ci", phone: "+225 07 00 00 01 12", plan: "Pro", subStatus: "active", subEndDate: day("2026-11-30"), vehicleCount: 24, deviceCount: 22, authDisabled: true, emailVerified: true, createdAt: day("2026-03-12"), lastSignInAt: ago(120), userType: "Entreprise", role: "Admin", traccarUserId: "1207", drivers: 19, assignments: 17, documents: 52, billingCycle: "monthly", autoRenew: true, subStartDate: day("2026-03-12"), permissions: null },
  { uid: "uid_Qa81Pz7c02Lm", name: "Mariam Diallo", email: "m.diallo@exemple.ci", phone: "+225 05 00 00 22 41", plan: "Essentiel", subStatus: "trial", subEndDate: day("2026-11-14"), vehicleCount: 3, deviceCount: 3, authDisabled: false, emailVerified: true, createdAt: day("2026-10-27"), lastSignInAt: ago(60), userType: "Particulier", role: "Admin", traccarUserId: "1588", drivers: 3, assignments: 3, documents: 9, billingCycle: "monthly", autoRenew: false, subStartDate: day("2026-10-27"), permissions: null },
  { uid: "uid_Zt0cR4mbPp4w", name: "Abidjan Moto Express", email: "contact@ame.exemple.ci", phone: "+225 01 00 00 93 07", plan: "Pro", subStatus: "expired", subEndDate: day("2026-11-02"), vehicleCount: 41, deviceCount: 38, authDisabled: false, emailVerified: true, createdAt: day("2026-01-04"), lastSignInAt: ago(8640), userType: "Entreprise", role: "Admin", traccarUserId: "1033", drivers: 44, assignments: 40, documents: 96, billingCycle: "monthly", autoRenew: false, subStartDate: day("2026-01-04"), permissions: null },
  { uid: "uid_Lm55Hk20a1Qx", name: "Serge Ehui", email: "s.ehui@exemple.ci", phone: "+225 07 00 00 64 30", plan: "Essentiel", subStatus: "expiring", subEndDate: day("2026-11-13"), vehicleCount: 6, deviceCount: 6, authDisabled: false, emailVerified: true, createdAt: day("2026-05-19"), lastSignInAt: ago(12), userType: "Particulier", role: "Admin", traccarUserId: "1342", drivers: 5, assignments: 5, documents: 14, billingCycle: "monthly", autoRenew: false, subStartDate: day("2026-05-19"), permissions: null },
  { uid: "uid_Pb3eT8wq77Kd", name: "Yamoussoukro Logistique", email: "flotte@ylog.exemple.ci", phone: "+225 27 00 00 30 88", plan: "Entreprise", subStatus: "active", subEndDate: day("2027-03-31"), vehicleCount: 112, deviceCount: 109, authDisabled: false, emailVerified: true, createdAt: day("2025-11-15"), lastSignInAt: ago(3), userType: "Entreprise", role: "Admin", traccarUserId: "0981", drivers: 97, assignments: 101, documents: 240, billingCycle: "yearly", autoRenew: true, subStartDate: day("2025-11-15"), permissions: null },
  { uid: "uid_Ux90Lw3nc2Te", name: "Fatou Bamba", email: "f.bamba@exemple.ci", phone: null, plan: "Gratuit", subStatus: "free", subEndDate: null, vehicleCount: 1, deviceCount: 0, authDisabled: false, emailVerified: false, createdAt: day("2026-11-08"), lastSignInAt: null, userType: "Particulier", role: "Admin", traccarUserId: null, drivers: 1, assignments: 0, documents: 0, billingCycle: "monthly", autoRenew: false, subStartDate: null, permissions: null },
  { uid: "uid_Rk2wGv6s9mNa", name: "Taxi Cocody Services", email: "admin@tcs.exemple.ci", phone: "+225 07 00 00 18 54", plan: "Pro", subStatus: "active", subEndDate: day("2026-11-22"), vehicleCount: 17, deviceCount: 17, authDisabled: false, emailVerified: true, createdAt: day("2026-02-02"), lastSignInAt: ago(40), userType: "Entreprise", role: "Gestionnaire", traccarUserId: "1129", drivers: 21, assignments: 16, documents: 38, billingCycle: "monthly", autoRenew: true, subStartDate: day("2026-02-02"), permissions: null },
  { uid: "uid_Hh41Yc8peR6s", name: "Bouaké Express Livraison", email: "ops@bel.exemple.ci", phone: "+225 07 00 00 77 02", plan: "Essentiel", subStatus: "active", subEndDate: day("2026-12-05"), vehicleCount: 9, deviceCount: 8, authDisabled: false, emailVerified: true, createdAt: day("2026-07-21"), lastSignInAt: ago(300), userType: "Entreprise", role: "Admin", traccarUserId: "1455", drivers: 10, assignments: 9, documents: 21, billingCycle: "monthly", autoRenew: true, subStartDate: day("2026-07-21"), permissions: null },
];

export interface DemoPosition { at: string; lat: number; lon: number; speedKmh: number }
export interface DemoTraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  model: string | null;
  category: string | null;
  disabled: boolean;
  lastUpdate: string | null;
  phone: string | null;
  contact: string | null;
  groupId: number | null;
  positions: DemoPosition[]; // most recent first
}
export interface DemoVehicle { id: string; label: string | null; plate: string | null; ownerId: string; deviceId: number | null; uniqueId: string | null }

const pos = (minAgo: number, lat: number, lon: number, speedKmh: number): DemoPosition => ({ at: ago(minAgo), lat, lon, speedKmh });
const dev = (id: number, name: string, uniqueId: string, model: string, lastUpdate: string | null, positions: DemoPosition[] = [], disabled = false): DemoTraccarDevice =>
  ({ id, name, uniqueId, model, category: model.startsWith("Concox") ? "motorcycle" : "car", disabled, lastUpdate, phone: null, contact: null, groupId: null, positions });

const traccarDevices: DemoTraccarDevice[] = [
  dev(6518, "TCS-Taxi-09", "358920106518009", "Teltonika FMB920", ago(4320), [], true),
  dev(6531, "TCS-Taxi-12", "358920106531012", "Teltonika FMB920", ago(9), [pos(9, 5.3478, -3.9921, 28)]),
  dev(6990, "Serge-Hilux", "358920106990044", "Teltonika FMB920", ago(6), [pos(6, 5.2924, -3.9655, 52)]),
  dev(7305, "BEL-Moto-02", "862123047305002", "Concox GT06N", ago(95), [pos(95, 7.6906, -5.03, 0)]),
  dev(7720, "YL-Camion-14", "358920107700120", "Teltonika FMC130", ago(2), [pos(2, 6.8205, -5.2767, 64), pos(7, 6.7931, -5.2845, 71)]),
  dev(8102, "AME-Livreur-3", "862123049900031", "Concox GT06N", ago(47), [pos(47, 5.3166, -4.0151, 0)]),
  dev(8790, "Dzire CD-5521", "358920101998877", "Teltonika FMB920", ago(4), [pos(4, 5.3364, -4.0267, 32), pos(9, 5.3412, -4.0199, 41), pos(14, 5.348, -4.0122, 18), pos(19, 5.3501, -4.009, 0)]),
  dev(9012, "Moto 07", "862123045566778", "Concox GT06N", ago(210), [pos(210, 5.3599, -3.9871, 0), pos(215, 5.3588, -3.9902, 22)]),
  dev(9330, "Boîtier stock 22", "358920109330022", "Teltonika FMB920", null),
];

const vehicles: DemoVehicle[] = [
  { id: "veh_ab1234", label: "Toyota Hiace · 2019", plate: "AB-1234-CI", ownerId: "uid_7Fq2Xa19k9Ze", deviceId: 8841, uniqueId: "358920101234567" }, // device absent from Traccar
  { id: "veh_cd5521", label: "Suzuki Dzire · 2022", plate: "CD-5521-CI", ownerId: "uid_7Fq2Xa19k9Ze", deviceId: 8790, uniqueId: "358920101998877" },
  { id: "veh_ef0902", label: "Yamaha Crypton · 2023", plate: "EF-0902-CI", ownerId: "uid_7Fq2Xa19k9Ze", deviceId: 9012, uniqueId: "862123045566778" },
  { id: "veh_gh7710", label: "Toyota Corolla · 2018", plate: "GH-7710-CI", ownerId: "uid_7Fq2Xa19k9Ze", deviceId: null, uniqueId: null },
  { id: "veh_yk4410", label: "Isuzu NPR · 2020", plate: "YK-4410-CI", ownerId: "uid_Pb3eT8wq77Kd", deviceId: 7720, uniqueId: "358920107700120" },
  { id: "veh_am0033", label: "Haojue HJ125 · 2022", plate: "AM-0033-CI", ownerId: "uid_Zt0cR4mbPp4w", deviceId: 8102, uniqueId: "862123049900031" },
  { id: "veh_tc0909", label: "Toyota Corolla · 2017", plate: "TC-0909-CI", ownerId: "uid_Rk2wGv6s9mNa", deviceId: 6518, uniqueId: "358920106518009" },
  { id: "veh_tc1212", label: "Toyota Corolla · 2019", plate: "TC-1212-CI", ownerId: "uid_Rk2wGv6s9mNa", deviceId: 6531, uniqueId: "358920106531012" },
  { id: "veh_bk0202", label: "Yamaha Crypton · 2021", plate: "BK-0202-CI", ownerId: "uid_Hh41Yc8peR6s", deviceId: 7305, uniqueId: "862123047305999" }, // uniqueId mismatch
  { id: "veh_se0044", label: "Toyota Hilux · 2016", plate: "SE-0044-CI", ownerId: "uid_Lm55Hk20a1Qx", deviceId: 6990, uniqueId: "358920106990044" },
  { id: "veh_fb0001", label: "Kia Picanto · 2015", plate: "FB-0001-CI", ownerId: "uid_Ux90Lw3nc2Te", deviceId: null, uniqueId: null },
];

/** Traccar user permissions (client account → visible device ids). */
const traccarPermissions = new Map<string, Set<number>>([
  ["uid_7Fq2Xa19k9Ze", new Set([8790, 9012])],
  ["uid_Pb3eT8wq77Kd", new Set([7720])],
  ["uid_Zt0cR4mbPp4w", new Set([8102])],
  ["uid_Rk2wGv6s9mNa", new Set([6518, 6531])],
  ["uid_Hh41Yc8peR6s", new Set([7305])],
  ["uid_Lm55Hk20a1Qx", new Set([6990])],
]);

export const DEMO_PLANS: Record<string, Record<string, unknown>> = {
  Gratuit: { maxVehicles: 1, gps: false, documents: true },
  Essentiel: { maxVehicles: 10, gps: true, documents: true },
  Pro: { maxVehicles: 50, gps: true, documents: true, reports: true },
  Entreprise: { maxVehicles: 1000, gps: true, documents: true, reports: true, api: true },
};

const staff: (StaffMember & { authDisabled?: boolean })[] = [
  { uid: "demo-staff", email: "demo@zira.local", displayName: "Awa Koné", role: "support", disabled: false, mfaEnrolled: true, lastSignInTime: new Date(NOW - 600e3).toUTCString() },
  { uid: "staff_yb", email: "y.brou@zira.local", displayName: "Yao Brou", role: "billing", disabled: false, mfaEnrolled: true, lastSignInTime: new Date(NOW - 86400e3).toUTCString() },
  { uid: "staff_root", email: "root@zira.local", displayName: "Admin Zira", role: "super_admin", disabled: false, mfaEnrolled: true, lastSignInTime: new Date(NOW - 3 * 86400e3).toUTCString() },
  { uid: "staff_ob", email: "obs@zira.local", displayName: "Observateur", role: "viewer", disabled: false, mfaEnrolled: false, lastSignInTime: null },
];
/** Firebase Auth accounts that exist but carry no staff claim (POST /staff target). */
const plainAccounts = [{ uid: "auth_new01", email: "nouvel.agent@zira.local", displayName: "Nouvel Agent" }];

const auditLogs: AuditLogEntry[] = [
  { id: "a3", actorUid: "demo-staff", actorEmail: "demo@zira.local", actorRole: "support", requestId: "req_9d2a0c41", action: "client.suspend", targetType: "client", targetId: "uid_7Fq2Xa19k9Ze", result: "success", reason: "Fraude au paiement signalée — ticket SUP-2291", before: { disabled: false }, after: { disabled: true }, error: null, createdAt: day("2026-11-08") },
  { id: "a1", actorUid: "staff_yb", actorEmail: "y.brou@zira.local", actorRole: "billing", requestId: "req_41c7aa10", action: "subscription.adjust", targetType: "subscription", targetId: "uid_7Fq2Xa19k9Ze", result: "success", reason: "Geste commercial suite à panne GPS de 5 jours", before: { endDate: day("2026-11-01") }, after: { endDate: day("2026-11-30") }, error: null, createdAt: day("2026-11-02") },
  { id: "a2", actorUid: "demo-staff", actorEmail: "demo@zira.local", actorRole: "support", requestId: "req_77e01b2c", action: "device.disable", targetType: "device", targetId: "8841", result: "failure", reason: "Boîtier volé — demande du client", before: null, after: null, error: "Device introuvable", createdAt: day("2026-10-28") },
];

const notes: ClientNote[] = [
  { id: "n1", clientId: "uid_7Fq2Xa19k9Ze", body: "Client rappelé : attend la régularisation du paiement avant réactivation.", authorUid: "demo-staff", authorEmail: "demo@zira.local", createdAt: day("2026-11-09") },
];

export const demo = {
  clients,
  traccarDevices,
  vehicles,
  traccarPermissions,
  staff,
  plainAccounts,
  auditLogs,
  notes,
  subscriptionOf(c: DemoClient): Subscription {
    return { planId: c.plan, status: c.subStatus, billingCycle: c.billingCycle, startDate: c.subStartDate, endDate: c.subEndDate, trialEndDate: c.subStatus === "trial" ? c.subEndDate : null, autoRenew: c.autoRenew };
  },
  vehiclesOf(ownerId: string) {
    return vehicles.filter((v) => v.ownerId === ownerId);
  },
};
