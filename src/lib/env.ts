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
  ZIRA_ADMIN_API_URL: z.url().optional().or(z.literal("")),
  ZIRA_ADMIN_API_TOKEN: z.string().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(14).default(1),
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
export const hasAdminApi = () => Boolean(env().ZIRA_ADMIN_API_URL);
