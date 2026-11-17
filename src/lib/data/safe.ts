import { unstable_rethrow } from "next/navigation";

/**
 * Turns a failed read into `null` for optional page blocks, without swallowing Next.js control
 * flow (redirect to /login on 401, notFound): those are re-thrown.
 */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}

/** Same, but keeps the error for display (status + requestId). */
export async function settle<T>(p: Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, data: await p };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e };
  }
}
