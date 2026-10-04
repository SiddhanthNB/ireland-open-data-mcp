import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface AuthEnv {
  readonly [name: string]: unknown;
  readonly OAUTH_KV?: KVNamespace;
  readonly OAUTH_PROVIDER?: OAuthHelpers;
}

export interface WorkerHandler<Env extends AuthEnv = AuthEnv> {
  fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Response | Promise<Response>;
}

export interface AuthDependencies {
  readonly fetch?: typeof globalThis.fetch;
}
