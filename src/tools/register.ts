import {
  McpServer,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { AppError } from "../errors";
import type { SourceRouter } from "../router";

const source = z
  .string()
  .min(1)
  .describe("One of: data_gov_ie, smart_dublin, met_eireann");
const limit = z.number().int().positive().optional();
const offset = z.number().int().nonnegative().optional();

function advertisedSchema(schema: z.ZodType): StandardSchemaWithJSON {
  const standard = schema["~standard"];

  return {
    "~standard": {
      ...standard,
      validate: (value: unknown) => ({ value }),
    },
  } as StandardSchemaWithJSON;
}

function toolResult(value: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function toolError(error: unknown): CallToolResult {
  const appError =
    error instanceof AppError ? error : new AppError("UPSTREAM_ERROR");
  const value = appError.toJSON();

  return {
    ...toolResult(value),
    isError: true,
  };
}

async function execute(operation: () => Promise<object>): Promise<CallToolResult> {
  try {
    return toolResult(await operation());
  } catch (error) {
    return toolError(error);
  }
}

async function executeValidated<T>(
  schema: z.ZodType<T>,
  input: unknown,
  operation: (input: T) => Promise<object>,
): Promise<CallToolResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return toolError(new AppError("INVALID_REQUEST"));
  }

  return execute(() => operation(parsed.data));
}

export function registerTools(server: McpServer, router: SourceRouter): void {
  const searchDatasetsInput = z
    .object({
      source,
      query: z.string().optional(),
      limit,
      offset,
    })
    .strict();
  const getDatasetInput = z
    .object({
      source,
      dataset_id: z.string().min(1),
    })
    .strict();
  const getResourceInput = z
    .object({
      source,
      dataset_id: z.string().min(1).optional(),
      resource_id: z.string().min(1),
      limit,
      offset,
    })
    .strict();

  server.registerTool(
    "search_datasets",
    {
      description: "Search datasets within one Irish public-data provider.",
      inputSchema: advertisedSchema(searchDatasetsInput),
    },
    async (input) =>
      executeValidated(searchDatasetsInput, input, ({ source, ...request }) =>
        router.resolve(source, "search_datasets").searchDatasets(request),
      ),
  );

  server.registerTool(
    "get_dataset",
    {
      description: "Retrieve metadata for one dataset.",
      inputSchema: advertisedSchema(getDatasetInput),
    },
    async (input) =>
      executeValidated(getDatasetInput, input, ({ source, ...request }) =>
        router.resolve(source, "get_dataset").getDataset(request),
      ),
  );

  server.registerTool(
    "get_resource",
    {
      description: "Retrieve data from one dataset resource.",
      inputSchema: advertisedSchema(getResourceInput),
    },
    async (input) =>
      executeValidated(getResourceInput, input, ({ source, ...request }) =>
        router.resolve(source, "get_resource").getResource(request),
      ),
  );
}
