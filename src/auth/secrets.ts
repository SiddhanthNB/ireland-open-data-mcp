import type { AuthEnv } from "./types";

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function requireSecret(env: AuthEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length < 32) {
    throw new AuthConfigurationError(
      `${name} must be configured as a secret with at least 32 characters`,
    );
  }

  return value;
}

export function requireEnvironmentValue(env: AuthEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthConfigurationError(`${name} must be configured`);
  }

  return value;
}

export function requireKv(env: AuthEnv): KVNamespace {
  const kv = env.OAUTH_KV;
  if (
    kv === undefined ||
    typeof kv.get !== "function" ||
    typeof kv.put !== "function" ||
    typeof kv.delete !== "function" ||
    typeof kv.list !== "function"
  ) {
    throw new AuthConfigurationError("OAUTH_KV binding is required for OAuth");
  }

  return kv;
}

export function configurationErrorResponse(): Response {
  return Response.json(
    { error: "AUTH_CONFIGURATION_ERROR" },
    { status: 500 },
  );
}
