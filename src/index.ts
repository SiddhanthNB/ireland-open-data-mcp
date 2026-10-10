import { createMcpHandler } from "agents/mcp/server";

import {
  createAuthHandler,
  type AuthEnv,
  type WorkerHandler,
} from "./auth";
import { serverConfig, type AuthConfig } from "./config";
import { DirectResourceLoader } from "./resources";
import { createSourceRouter } from "./runtime";
import { createServer } from "./server";

export interface WorkerDependencies {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  authConfig?: AuthConfig;
}

export function createWorkerHandler(
  dependencies: WorkerDependencies = {},
): WorkerHandler {
  const resourceLimits = {
    maxInputBytes: serverConfig.resources.max_input_bytes,
    maxOutputBytes: serverConfig.resources.max_output_bytes,
  };
  const resourceLoader = new DirectResourceLoader({
    fetch: dependencies.fetch,
    ...resourceLimits,
  });
  const router = createSourceRouter({
    resourceLoader,
    ...resourceLimits,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  const handleMcp = createMcpHandler(() => createServer(router), {
    route: "/mcp",
    legacy: "stateless",
  });

  const mcpHandler = {
    fetch(request: Request, env: AuthEnv, context: ExecutionContext) {
      return handleMcp(request, env, context);
    },
  };

  return createAuthHandler(
    dependencies.authConfig ?? serverConfig.auth,
    mcpHandler,
  );
}

const handler = createWorkerHandler();

export default {
  fetch(request, env, ctx) {
    return handler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AuthEnv>;
