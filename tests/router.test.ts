import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors";
import type { ProviderConfig, Source } from "../src/models";
import type { ProviderAdapter } from "../src/providers/provider";
import { SourceRouter } from "../src/router";

function createAdapter(
  provider: Source,
  capabilities: ProviderConfig["capabilities"] = {
    search_datasets: true,
    get_dataset: true,
    get_resource: true,
  },
): ProviderAdapter {
  return {
    config: {
      provider,
      base_url: "https://example.com",
      endpoints: {},
      http_timeout_ms: 5_000,
      pagination: { default_limit: 10, max_limit: 100 },
      capabilities,
      formats: ["json"],
    },
    searchDatasets: async () => ({
      datasets: [],
      pagination: { limit: 10, offset: 0, returned: 0 },
    }),
    getDataset: async () => {
      throw new Error("not used");
    },
    getResource: async () => {
      throw new Error("not used");
    },
  };
}

describe("SourceRouter", () => {
  const dataGovAdapter = createAdapter("data_gov_ie", {
    search_datasets: true,
    get_dataset: false,
    get_resource: true,
  });
  const smartDublinAdapter = createAdapter("smart_dublin");
  const metEireannAdapter = createAdapter("met_eireann");
  const adapters = [dataGovAdapter, smartDublinAdapter, metEireannAdapter];
  const router = new SourceRouter(adapters);

  function expectCode(action: () => unknown, code: AppError["code"]): void {
    try {
      action();
      throw new Error("Expected an AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(code);
    }
  }

  it("returns the registered adapter for a supported operation", () => {
    expect(router.resolve("data_gov_ie", "search_datasets")).toBe(
      dataGovAdapter,
    );
  });

  it("rejects an unknown source", () => {
    expectCode(
      () => router.resolve("unknown", "search_datasets"),
      "INVALID_SOURCE",
    );
  });

  it("fails during construction when a source is not registered", () => {
    expect(
      () => new SourceRouter([dataGovAdapter, smartDublinAdapter]),
    ).toThrow("Missing provider adapter: met_eireann");
  });

  it("rejects duplicate adapter registration", () => {
    expect(
      () => new SourceRouter([...adapters, createAdapter("data_gov_ie")]),
    ).toThrow("Duplicate provider adapter: data_gov_ie");
  });

  it("enforces provider capabilities", () => {
    expectCode(
      () => router.resolve("data_gov_ie", "get_dataset"),
      "UNSUPPORTED_OPERATION",
    );
  });
});
