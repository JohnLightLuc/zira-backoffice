import "server-only";
import type { AuditEntry, ClientRow, Device, Position, Subscription } from "@/lib/data/types";

/**
 * Anonymised demo fixtures (spec §12.2), used only when ZIRA_DEMO_MODE=true.
 * Mutations (suspend, disable device, audit) live in memory for the lifetime of the server process.
 */
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const day = (d: string) => new Date(d + "T00:00:00Z").toISOString();

interface DemoClient extends ClientRow {
  userType: string;
  role: string;
  traccarUserId: string;
  drivers: number;
  assignments: number;
  documents: number;
  billingCycle: string;
  autoRenew: boolean;
}

const clients: DemoClient[] = [
  { uid: "uid_7Fq2Xa19k9Ze", name: "Kouassi Transport SARL", email: "k.transport@exemple.ci", phone: "+225 07 00 00 01 12", plan: "Pro", subStatus: "active", subEndDate: day("2026-11-30"), vehicleCount: 24, deviceCount: 22, authDisabled: true, emailVerified: true, createdAt: day("2026-03-12"), lastSignInAt: ago(120), userType: "Entreprise", role: "Admin", traccarUserId: "1207", drivers: 19, assignments: 17, documents: 52, billingCycle: "monthly", autoRenew: true },
  { uid: "uid_Qa81Pz7c02Lm", name: "Mariam Diallo", email: "m.diallo@exemple.ci", phone: "+225 05 00 00 22 41", plan: "Essentiel", subStatus: "trial", subEndDate: day("2026-11-14"), vehicleCount: 3, deviceCount: 3, authDisabled: false, emailVerified: true, createdAt: day("2026-10-27"), lastSignInAt: ago(60), userType: "Particulier", role: "Admin", traccarUserId: "1588", drivers: 3, assignments: 3, documents: 9, billingCycle: "monthly", autoRenew: false },
  { uid: "uid_Zt0cR4mbPp4w", name: "Abidjan Moto Express", email: "contact@ame.exemple.ci", phone: "+225 01 00 00 93 07", plan: "Pro", subStatus: "expired", subEndDate: day("2026-11-02"), vehicleCount: 41, deviceCount: 38, authDisabled: false, emailVerified: true, createdAt: day("2026-01-04"), lastSignInAt: ago(8640), userType: "Entreprise", role: "Admin", traccarUserId: "1033", drivers: 44, assignments: 40, documents: 96, billingCycle: "monthly", autoRenew: false },
  { uid: "uid_Lm55Hk20a1Qx", name: "Serge Ehui", email: "s.ehui@exemple.ci", phone: "+225 07 00 00 64 30", plan: "Essentiel", subStatus: "expiring", subEndDate: day("2026-11-13"), vehicleCount: 6, deviceCount: 6, authDisabled: false, emailVerified: true, createdAt: day("2026-05-19"), lastSignInAt: ago(12), userType: "Particulier", role: "Admin", traccarUserId: "1342", drivers: 5, assignments: 5, documents: 14, billingCycle: "monthly", autoRenew: false },
  { uid: "uid_Pb3eT8wq77Kd", name: "Yamoussoukro Logistique", email: "flotte@ylog.exemple.ci", phone: "+225 27 00 00 30 88", plan: "Entreprise", subStatus: "active", subEndDate: day("2027-03-31"), vehicleCount: 112, deviceCount: 109, authDisabled: false, emailVerified: true, createdAt: day("2025-11-15"), lastSignInAt: ago(3), userType: "Entreprise", role: "Admin", traccarUserId: "0981", drivers: 97, assignments: 101, documents: 240, billingCycle: "yearly", autoRenew: true },
  { uid: "uid_Ux90Lw3nc2Te", name: "Fatou Bamba", email: "f.bamba@exemple.ci", phone: null, plan: "Gratuit", subStatus: "free", subEndDate: null, vehicleCount: 1, deviceCount: 0, authDisabled: false, emailVerified: false, createdAt: day("2026-11-08"), lastSignInAt: null, userType: "Particulier", role: "Admin", traccarUserId: "1702", drivers: 1, assignments: 0, documents: 0, billingCycle: "monthly", autoRenew: false },
  { uid: "uid_Rk2wGv6s9mNa", name: "Taxi Cocody Services", email: "admin@tcs.exemple.ci", phone: "+225 07 00 00 18 54", plan: "Pro", subStatus: "active", subEndDate: day("2026-11-22"), vehicleCount: 17, deviceCount: 17, authDisabled: false, emailVerified: true, createdAt: day("2026-02-02"), lastSignInAt: ago(40), userType: "Entreprise", role: "Gestionnaire", traccarUserId: "1129", drivers: 21, assignments: 16, documents: 38, billingCycle: "monthly", autoRenew: true },
  { uid: "uid_Hh41Yc8peR6s", name: "Bouaké Express Livraison", email: "ops@bel.exemple.ci", phone: "+225 07 00 00 77 02", plan: "Essentiel", subStatus: "active", subEndDate: day("2026-12-05"), vehicleCount: 9, deviceCount: 8, authDisabled: false, emailVerified: true, createdAt: day("2026-07-21"), lastSignInAt: ago(300), userType: "Entreprise", role: "Admin", traccarUserId: "1455", drivers: 10, assignments: 9, documents: 21, billingCycle: "monthly", autoRenew: true },
];

interface DemoDevice extends Device {
  vehicleLabel: string;
  positions: Position[];
}
const pos = (minAgo: number, lat: number, lon: number, speedKmh: number): Position => ({ at: ago(minAgo), lat, lon, speedKmh });
const devices: DemoDevice[] = [
  { id: "8841", name: "Hiace AB-1234", uniqueId: "358920101234567", model: "Teltonika FMB920", ownerUid: "uid_7Fq2Xa19k9Ze", ownerName: null, vehicleId: "veh_ab1234", vehiclePlate: "AB-1234-CI", vehicleLabel: "Toyota Hiace · 2019", disabled: false, lastUpdate: null, link: "missing_in_traccar", positions: [] },
  { id: "8790", name: "Dzire CD-5521", uniqueId: "358920101998877", model: "Teltonika FMB920", ownerUid: "uid_7Fq2Xa19k9Ze", ownerName: null, vehicleId: "veh_cd5521", vehiclePlate: "CD-5521-CI", vehicleLabel: "Suzuki Dzire · 2022", disabled: false, lastUpdate: ago(4), link: "ok", positions: [pos(4, 5.3364, -4.0267, 32), pos(9, 5.3412, -4.0199, 41), pos(14, 5.348, -4.0122, 18), pos(19, 5.3501, -4.009, 0)] },
  { id: "9012", name: "Moto 07", uniqueId: "862123045566778", model: "Concox GT06N", ownerUid: "uid_7Fq2Xa19k9Ze", ownerName: null, vehicleId: "veh_ef0902", vehiclePlate: "EF-0902-CI", vehicleLabel: "Yamaha Crypton · 2023", disabled: false, lastUpdate: ago(210), link: "ok", positions: [pos(210, 5.3599, -3.9871, 0), pos(215, 5.3588, -3.9902, 22)] },
  { id: "7720", name: "YL-Camion-14", uniqueId: "358920107700120", model: "Teltonika FMC130", ownerUid: "uid_Pb3eT8wq77Kd", ownerName: null, vehicleId: "veh_yk4410", vehiclePlate: "YK-4410-CI", vehicleLabel: "Isuzu NPR · 2020", disabled: false, lastUpdate: ago(2), link: "ok", positions: [pos(2, 6.8205, -5.2767, 64), pos(7, 6.7931, -5.2845, 71)] },
  { id: "8102", name: "AME-Livreur-3", uniqueId: "862123049900031", model: "Concox GT06N", ownerUid: "uid_Zt0cR4mbPp4w", ownerName: null, vehicleId: "veh_am0033", vehiclePlate: "AM-0033-CI", vehicleLabel: "Haojue HJ125 · 2022", disabled: false, lastUpdate: ago(47), link: "ok", positions: [pos(47, 5.3166, -4.0151, 0)] },
  { id: "9330", name: "Boîtier stock 22", uniqueId: "358920109330022", model: "Teltonika FMB920", ownerUid: null, ownerName: null, vehicleId: null, vehiclePlate: null, vehicleLabel: "", disabled: false, lastUpdate: null, link: "unlinked", positions: [] },
  { id: "6518", name: "TCS-Taxi-09", uniqueId: "358920106518009", model: "Teltonika FMB920", ownerUid: "uid_Rk2wGv6s9mNa", ownerName: null, vehicleId: "veh_tc0909", vehiclePlate: "TC-0909-CI", vehicleLabel: "Toyota Corolla · 2017", disabled: true, lastUpdate: ago(4320), link: "ok", positions: [] },
  { id: "6531", name: "TCS-Taxi-12", uniqueId: "358920106531012", model: "Teltonika FMB920", ownerUid: "uid_Rk2wGv6s9mNa", ownerName: null, vehicleId: "veh_tc1212", vehiclePlate: "TC-1212-CI", vehicleLabel: "Toyota Corolla · 2019", disabled: false, lastUpdate: ago(9), link: "ok", positions: [pos(9, 5.3478, -3.9921, 28)] },
  { id: "7305", name: "BEL-Moto-02", uniqueId: "862123047305002", model: "Concox GT06N", ownerUid: "uid_Hh41Yc8peR6s", ownerName: null, vehicleId: "veh_bk0202", vehiclePlate: "BK-0202-CI", vehicleLabel: "Yamaha Crypton · 2021", disabled: false, lastUpdate: ago(95), link: "ok", positions: [pos(95, 7.6906, -5.03, 0)] },
  { id: "6990", name: "Serge-Hilux", uniqueId: "358920106990044", model: "Teltonika FMB920", ownerUid: "uid_Lm55Hk20a1Qx", ownerName: null, vehicleId: "veh_se0044", vehiclePlate: "SE-0044-CI", vehicleLabel: "Toyota Hilux · 2016", disabled: false, lastUpdate: ago(6), link: "ok", positions: [pos(6, 5.2924, -3.9655, 52)] },
];
for (const d of devices) d.ownerName = clients.find((c) => c.uid === d.ownerUid)?.name ?? null;

const audit: AuditEntry[] = [
  { id: "a1", action: "Abonnement prolongé", actorUid: "staff_yb", actorName: "Yao Brou", role: "billing", targetType: "subscription", targetId: "uid_7Fq2Xa19k9Ze", at: day("2026-11-02"), result: "success", requestId: "req_41c7", change: { field: "endDate", before: "01/11/2026", after: "30/11/2026" }, reason: "Geste commercial suite à panne GPS de 5 jours" },
  { id: "a2", action: "Désactivation device 8841", actorUid: "staff_ak", actorName: "Awa Koné", role: "support", targetType: "device", targetId: "8841", at: day("2026-10-28"), result: "failure", requestId: "req_77e0", reason: "Boîtier volé — demande du client" },
  { id: "a3", action: "Compte suspendu", actorUid: "staff_ak", actorName: "Awa Koné", role: "support", targetType: "client", targetId: "uid_7Fq2Xa19k9Ze", at: day("2026-11-08"), result: "success", requestId: "req_9d2a", change: { field: "disabled", before: "false", after: "true" }, reason: "Fraude au paiement signalée — ticket SUP-2291" },
];
const auditOwner: Record<string, string> = { a1: "uid_7Fq2Xa19k9Ze", a2: "uid_7Fq2Xa19k9Ze", a3: "uid_7Fq2Xa19k9Ze" };

export const demo = {
  clients,
  devices,
  subscriptionOf(c: DemoClient): Subscription {
    return { planId: c.plan, status: c.subStatus, billingCycle: c.billingCycle, startDate: null, endDate: c.subEndDate, trialEndDate: c.subStatus === "trial" ? c.subEndDate : null, autoRenew: c.autoRenew };
  },
  auditFor(ownerUid: string) {
    return audit.filter((a) => auditOwner[a.id] === ownerUid).sort((a, b) => b.at.localeCompare(a.at));
  },
  pushAudit(ownerUid: string | null, entry: AuditEntry) {
    audit.push(entry);
    if (ownerUid) auditOwner[entry.id] = ownerUid;
  },
};
export type { DemoClient, DemoDevice };
