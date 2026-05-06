import type { AuthStorage } from "@mariozechner/pi-coding-agent";

const PROVIDER_ID = "poolside";

/**
 * Get the Poolside API key through Pi's auth handling.
 *
 * Resolution order:
 * 1. Runtime override (CLI --api-key)
 * 2. auth.json entry for "poolside"
 * 3. Environment variable POOLSIDE_API_KEY
 */
export async function getPoolsideApiKey(
  authStorage: AuthStorage,
): Promise<string | undefined> {
  const key = await authStorage.getApiKey(PROVIDER_ID);
  return key ?? process.env.POOLSIDE_API_KEY;
}
