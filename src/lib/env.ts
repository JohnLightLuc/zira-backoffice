import "server-only";
import { z } from "zod";
import { STAFF_ROLES } from "@/lib/auth/rbac";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_ZIRA_ENV: z.enum(["production", "staging", "development"]).default("development"),
  ZIRA_DEMO_MODE: z.string().optional().transform((v) => v === "true"),
  ZIRA_DEMO_ROLE: z.enum(STAFF_ROLES).default("support"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  // Base URL of fleet_backend (NestJS); routes are prefixed with /admin/v1 (BACKOFFICE_API.md §4.1).
  // Calls are authenticated with the staff member's Firebase ID token: no service token here.
  ADMIN_API_URL: z.url().optional().or(z.literal("")),
  ZIRA_REQUIRE_MFA: z.string().optional().transform((v) => v !== "false"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Configuration invalide : ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  const e = parsed.data;
  // The demo mode serves fixtures without any authentication: never in a production deployment.
  if (e.ZIRA_DEMO_MODE && e.NEXT_PUBLIC_ZIRA_ENV === "production") {
    throw new Error("ZIRA_DEMO_MODE est interdit quand NEXT_PUBLIC_ZIRA_ENV=production.");
  }
  cached = e;
  return e;
}

export const isDemo = () => env().ZIRA_DEMO_MODE;
/** Demo mode serves the in-memory /admin/v1 implementation, so the API is always "connected" there. */
export const hasAdminApi = () => isDemo() || Boolean(env().ADMIN_API_URL);
