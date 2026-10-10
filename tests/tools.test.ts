import { createMcpHandler } from "agents/mcp/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { providerConfigs } from "../src/config";
import type {
  Dataset,
  DatasetSearchResult,
  ProviderCapabilities,
  ProviderConfig,
  Resource,
  Source,
} from "../src/models";
import type {
  GetDatasetInput,
  GetResourceInput,
  ProviderAdapter,
  SearchDatasetsInput,
} from "../src/providers/provider";
import { SourceRouter } from "../src/router";
import { createServer } from "../src/server";

const commonMaximumLimit = Math.min(
  ...Object.values(providerConfigs).map(
    (config) => config.pagination.max_limit,
  ),
);
const configuredDefaults = Object.values(providerConfigs)
  .map(
    (config) =>
      `${config.provider}=${config.pagination.default_limit}`,
  )
  .join(", ");

type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

type JsonRpcResponse = {
  result?: ToolResult & {
    tools?: Array<{
      name: string;
      description?: string;
      inputSchema: {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      };
    }>;
  };
  error?: Record<string, unknown>;
};

const protocolVersion = "2025-11-25";
const provenance = {
  source: "data_gov_ie" as const,
  upstream_url: "https://example.com/dataset/roads",
  retrieved_at: "2026-10-04T12:00:00.000Z",
};

const searchResult: DatasetSearchResult = {
  datasets: [
    {
      dataset_id: "roads",
      title: "Roads",
      available_formats: ["json"],
      provenance,
    },
  ],
  pagination: { limit: 5, offset: 0, returned: 1, total: 1 },
};

const dataset: Dataset = {
  ...searchResult.datasets[0],
  resources: [
    {
      resource_id: "roads-json",
      format: "json",
      supported: true,
      upstream_url: "https://example.com/resource/roads-json",
    },
  ],
};

const resource: Resource = {
  dataset_id: "roads",
  resource_id: "roads-json",
  data: [{ id: 1 }],
  provenance: { ...provenance, original_format: "json" },
  pagination_supported: true,
  pagination: { limit: 1, offset: 0, returned: 1 },
};

function createAdapter(
  provider: Source,
  capabilities: ProviderCapabilities,
): ProviderAdapter {
  const config: ProviderConfig = {
    provider,
    base_url: "https://example.com",
    endpoints: {},
    http_timeout_ms: 5_000,
    pagination: { default_limit: 10, max_limit: 100 },
    capabilities,
    formats: ["json"],
  };

  return {
    config,
    searchDatasets: vi.fn(async (_input: SearchDatasetsInput) => searchResult),
    getDataset: vi.fn(async (_input: GetDatasetInput) => dataset),
    getResource: vi.fn(async (_input: GetResourceInput) => resource),
  };
}

const allCapabilities: ProviderCapabilities = {
  search_datasets: true,
  get_dataset: true,
  get_resource: true,
};

const dataGovAdapter = createAdapter("data_gov_ie", allCapabilities);
const smartDublinAdapter = createAdapter("smart_dublin", allCapabilities);
const metEireannAdapter = createAdapter("met_eireann", {
  ...allCapabilities,
  get_resource: false,
});
const router = new SourceRouter([
  dataGovAdapter,
  smartDublinAdapter,
  metEireannAdapter,
]);
const handler = createMcpHandler(() => createServer(router), {
  route: "/mcp",
  legacy: "stateless",
});

async function sendMcpRequest(
  method: string,
  params: Record<string, unknown>,
  id: number,
): Promise<{ response: Response; payload: JsonRpcResponse }> {
  const response = await handler.fetch(
    new Request("http://example.com/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": protocolVersion,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
  );

  const body = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? body
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim()
    : body;

  if (!data) {
    throw new Error(`MCP response did not contain a result: ${body}`);
  }

  return { response, payload: JSON.parse(data) as JsonRpcResponse };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ response: Response; result: ToolResult }> {
  const { response, payload } = await sendMcpRequest(
    "tools/call",
    { name, arguments: args },
    1,
  );

  expect(payload.error).toBeUndefined();
  expect(payload.result).toBeDefined();
  return { response, result: payload.result! };
}

function errorContent(result: ToolResult): unknown {
  return JSON.parse(result.content?.[0]?.text ?? "null") as unknown;
}

describe("generic MCP tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("discovers the three generic tools without creating a session", async () => {
    const { response, payload } = await sendMcpRequest("tools/list", {}, 1);

    expect(response.status).toBe(200);
    expect(response.headers.get("MCP-Session-Id")).toBeNull();
    expect(payload.result?.tools?.map((tool) => tool.name)).toEqual([
      "search_datasets",
      "get_dataset",
      "get_resource",
    ]);
    expect(payload.result?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "search_datasets",
          description: expect.stringContaining(
            `maximum limit of ${commonMaximumLimit}`,
          ),
          inputSchema: expect.objectContaining({
            type: "object",
            required: ["source"],
            properties: expect.objectContaining({
              limit: expect.objectContaining({
                type: "integer",
                minimum: 1,
                maximum: commonMaximumLimit,
                description: expect.stringContaining(
                  `Provider defaults: ${configuredDefaults}`,
                ),
              }),
              offset: expect.objectContaining({
                type: "integer",
                minimum: 0,
                description: expect.any(String),
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: "get_dataset",
          description: expect.stringContaining(
            "other formats remain visible as metadata",
          ),
          inputSchema: expect.objectContaining({
            type: "object",
            required: ["source", "dataset_id"],
          }),
        }),
        expect.objectContaining({
          name: "get_resource",
          description: expect.stringContaining(
            "does not execute APIs described by OpenAPI",
          ),
          inputSchema: expect.objectContaining({
            type: "object",
            required: ["source", "dataset_id", "resource_id"],
            properties: expect.objectContaining({
              limit: expect.objectContaining({
                type: "integer",
                minimum: 1,
                maximum: commonMaximumLimit,
                description: expect.stringMatching(
                  new RegExp(
                    `pageable resources.*Provider defaults: ${configuredDefaults}`,
                  ),
                ),
              }),
              offset: expect.objectContaining({
                type: "integer",
                minimum: 0,
                description: expect.stringContaining("pageable resources"),
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it("delegates search_datasets and returns normalized data", async () => {
    const { result } = await callTool("search_datasets", {
      source: "data_gov_ie",
      query: "roads",
      limit: 5,
      offset: 0,
    });

    expect(dataGovAdapter.searchDatasets).toHaveBeenCalledWith({
      query: "roads",
      limit: 5,
      offset: 0,
    });
    expect(result.structuredContent).toEqual(searchResult);
  });

  it("delegates get_dataset and get_resource", async () => {
    const datasetResult = await callTool("get_dataset", {
      source: "smart_dublin",
      dataset_id: "roads",
    });
    const resourceResult = await callTool("get_resource", {
      source: "data_gov_ie",
      dataset_id: "roads",
      resource_id: "roads-json",
      limit: 1,
      offset: 0,
    });

    expect(smartDublinAdapter.getDataset).toHaveBeenCalledWith({
      dataset_id: "roads",
    });
    expect(dataGovAdapter.getResource).toHaveBeenCalledWith({
      dataset_id: "roads",
      resource_id: "roads-json",
      limit: 1,
      offset: 0,
    });
    expect(datasetResult.result.structuredContent).toEqual(dataset);
    expect(resourceResult.result.structuredContent).toEqual(resource);
  });

  it("serializes source and capability errors", async () => {
    const invalidSource = await callTool("get_dataset", {
      source: "unknown",
      dataset_id: "roads",
    });
    const unsupported = await callTool("get_resource", {
      source: "met_eireann",
      dataset_id: "roads",
      resource_id: "roads-json",
    });

    expect(invalidSource.result.isError).toBe(true);
    expect(errorContent(invalidSource.result)).toEqual({
      error: "INVALID_SOURCE",
      message: "The requested source is not supported.",
    });
    expect(unsupported.result.isError).toBe(true);
    expect(errorContent(unsupported.result)).toEqual({
      error: "UNSUPPORTED_OPERATION",
      message: "The requested operation is not supported by this source.",
    });
  });

  it("returns field-specific INVALID_REQUEST errors before calling an adapter", async () => {
    const invalidSearch = await callTool("search_datasets", {
      source: "data_gov_ie",
      limit: 0,
    });
    const invalidDataset = await callTool("get_dataset", {
      source: "data_gov_ie",
      dataset_id: "",
    });
    const invalidResource = await callTool("get_resource", {
      source: "data_gov_ie",
      dataset_id: "roads",
      resource_id: "",
    });
    const missingDataset = await callTool("get_resource", {
      source: "data_gov_ie",
      resource_id: "roads-json",
    });
    const excessiveLimit = await callTool("get_resource", {
      source: "data_gov_ie",
      dataset_id: "roads",
      resource_id: "roads-json",
      limit: commonMaximumLimit + 1,
    });
    const negativeOffset = await callTool("search_datasets", {
      source: "data_gov_ie",
      offset: -1,
    });

    expect(invalidSearch.result.isError).toBe(true);
    expect(invalidDataset.result.isError).toBe(true);
    expect(invalidResource.result.isError).toBe(true);
    expect(missingDataset.result.isError).toBe(true);
    expect(excessiveLimit.result.isError).toBe(true);
    expect(negativeOffset.result.isError).toBe(true);
    expect(errorContent(invalidSearch.result)).toEqual({
      error: "INVALID_REQUEST",
      message: `The "limit" field must be an integer between 1 and ${commonMaximumLimit}.`,
    });
    expect(errorContent(invalidDataset.result)).toEqual({
      error: "INVALID_REQUEST",
      message:
        'The "dataset_id" field is required and must be a non-empty string.',
    });
    expect(errorContent(invalidResource.result)).toEqual({
      error: "INVALID_REQUEST",
      message:
        'The "resource_id" field is required and must be a non-empty string.',
    });
    expect(errorContent(missingDataset.result)).toEqual({
      error: "INVALID_REQUEST",
      message:
        'The "dataset_id" field is required and must be a non-empty string.',
    });
    expect(errorContent(excessiveLimit.result)).toEqual({
      error: "INVALID_REQUEST",
      message: `The "limit" field must be an integer between 1 and ${commonMaximumLimit}.`,
    });
    expect(errorContent(negativeOffset.result)).toEqual({
      error: "INVALID_REQUEST",
      message: 'The "offset" field must be a non-negative integer.',
    });
    expect(dataGovAdapter.searchDatasets).not.toHaveBeenCalled();
    expect(dataGovAdapter.getDataset).not.toHaveBeenCalled();
    expect(dataGovAdapter.getResource).not.toHaveBeenCalled();
  });
});
