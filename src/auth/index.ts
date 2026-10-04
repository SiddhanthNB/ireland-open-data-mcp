import type { AuthConfig } from "../config";
import { createBearerHandler } from "./bearer";
import { createOAuthHandler } from "./oauth";
import type {
  AuthDependencies,
  AuthEnv,
  WorkerHandler,
} from "./types";

export type { AuthDependencies, AuthEnv, WorkerHandler } from "./types";
export { AuthConfigurationError } from "./secrets";

export function createAuthHandler(
  config: AuthConfig,
  mcpHandler: WorkerHandler,
  dependencies: AuthDependencies = {},
): WorkerHandler {
  switch (config.mode) {
    case "none":
      return mcpHandler;
    case "bearer":
      return createBearerHandler(config.bearer, mcpHandler);
    case "oauth":
      return createOAuthHandler(config.oauth, mcpHandler, dependencies);
  }
}
