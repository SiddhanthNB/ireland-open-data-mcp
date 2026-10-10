import {
  McpServer,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { providerConfigs } from "../config";
import { AppError } from "../errors";
import type { SourceRouter } from "../router";

const configuredProviders = Object.values(providerConfigs);
const commonMaximumLimit = Math.min(
  ...configuredProviders.map((config) => config.pagination.max_limit),
);
const configuredDefaults = configuredProviders
  .map(
    (config) =>
      `${config.provider}=${config.pagination.default_limit}`,
  )
  .join(", ");
const limitRange = `integer from 1 to ${commonMaximumLimit}`;
const defaultLimitDescription = `Provider defaults: ${configuredDefaults}.`;

const source = z
  .string()
  .min(1)
  .describe(
    "One catalogue: data_gov_ie (national), smart_dublin (Smart Dublin), or met_eireann (Met Eireann publisher subset of data.gov.ie).",
  );
const searchLimit = z
  .number()
  .int()
  .min(1)
  .max(commonMaximumLimit)
  .optional()
  .describe(
    `Search results to return: ${limitRange}. ${defaultLimitDescription}`,
  );
const searchOffset = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe("Search results to skip: non-negative integer.");
const resourceLimit = z
  .number()
  .int()
  .min(1)
  .max(commonMaximumLimit)
  .optional()
  .describe(
    `Rows or array items to return: ${limitRange}; only applies to pageable resources. ${defaultLimitDescription}`,
  );
const resourceOffset = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe(
    "Rows or array items to skip: non-negative integer; only applies to pageable resources.",
  );

const validationMessages: Readonly<Record<string, string>> = {
  source: 'The "source" field must be a non-empty string.',
  query: 'The "query" field must be a string.',
  limit: `The "limit" field must be an integer between 1 and ${commonMaximumLimit}.`,
  offset: 'The "offset" field must be a non-negative integer.',
  dataset_id: 'The "dataset_id" field is required and must be a non-empty string.',
  resource_id:
    'The "resource_id" field is required and must be a non-empty string.',
};

function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue?.path[0];

  if (typeof field === "string" && validationMessages[field]) {
    return validationMessages[field];
  }

  if (issue?.code === "unrecognized_keys") {
    return "The request contains unsupported fields.";
  }

  return "The request is invalid.";
}

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
    return toolError(
      new AppError("INVALID_REQUEST", validationMessage(parsed.error)),
    );
  }

  return execute(() => operation(parsed.data));
}

export function registerTools(server: McpServer, router: SourceRouter): void {
  const searchDatasetsInput = z
    .object({
      source,
      query: z.string().optional().describe("Optional upstream keyword query."),
      limit: searchLimit,
      offset: searchOffset,
    })
    .strict();
  const getDatasetInput = z
    .object({
      source,
      dataset_id: z
        .string()
        .min(1)
        .describe("Catalogue dataset ID returned by search_datasets."),
    })
    .strict();
  const getResourceInput = z
    .object({
      source,
      dataset_id: z
        .string()
        .min(1)
        .describe("Catalogue dataset ID returned by search_datasets."),
      resource_id: z
        .string()
        .min(1)
        .describe("Resource ID returned in the matching get_dataset response."),
      limit: resourceLimit,
      offset: resourceOffset,
    })
    .strict();

  server.registerTool(
    "search_datasets",
    {
      description:
        `Search one catalogue: data_gov_ie is the national catalogue, smart_dublin is the Smart Dublin catalogue, and met_eireann is the Met Eireann publisher subset of data.gov.ie. Results may overlap because catalogues harvest the same dataset; source selects the upstream representation. Use returned dataset_id values with get_dataset. limit and offset paginate results, with a maximum limit of ${commonMaximumLimit}. ${defaultLimitDescription} Reported formats are catalogue metadata; get_resource retrieves direct CSV, JSON, XML, and CKAN DataStore-backed resources.`,
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
      description:
        "Get dataset metadata from one catalogue: data_gov_ie is national, smart_dublin is Smart Dublin, and met_eireann is the Met Eireann publisher subset of data.gov.ie. Use a dataset_id returned by search_datasets. The resource list supplies resource_id values for get_resource and marks whether each catalogue resource is supported. Direct CSV, JSON, XML, and CKAN DataStore-backed resources are retrievable; other formats remain visible as metadata.",
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
      description:
        `Fetch a catalogue resource from one source: data_gov_ie is national, smart_dublin is Smart Dublin, and met_eireann is the Met Eireann publisher subset of data.gov.ie. Pass the matching dataset_id and resource_id returned by get_dataset. Retrieves direct CSV, JSON, XML, or CKAN DataStore-backed resources. It fetches the resource linked by the catalogue; it does not execute APIs described by OpenAPI or other documents. limit and offset apply only to tabular data and JSON arrays, with a maximum limit of ${commonMaximumLimit}. ${defaultLimitDescription} Pagination is omitted when not applicable, and total is optional when an upstream or bounded response cannot provide it.`,
      inputSchema: advertisedSchema(getResourceInput),
    },
    async (input) =>
      executeValidated(getResourceInput, input, ({ source, ...request }) =>
        router.resolve(source, "get_resource").getResource(request),
      ),
  );
}
