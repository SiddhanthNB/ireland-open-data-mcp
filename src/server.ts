import { McpServer } from "@modelcontextprotocol/server";

import type { SourceRouter } from "./router";
import { registerTools } from "./tools/register";

export function createServer(router: SourceRouter): McpServer {
  const server = new McpServer(
    {
      name: "ireland-open-data-mcp",
      version: "0.0.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  registerTools(server, router);

  return server;
}
