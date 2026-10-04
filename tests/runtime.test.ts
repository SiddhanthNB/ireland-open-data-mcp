import { describe, expect, it } from "vitest";

import { providerConfigs } from "../src/config/index";
import { SOURCES, PROVIDER_OPERATIONS } from "../src/models";
import { DataGovAdapter } from "../src/providers/data-gov-ie";
import type {
  ResourceLoadRequest,
  ResourceLoader,
} from "../src/providers/ckan/index";
import { MetEireannAdapter } from "../src/providers/met-eireann";
import { SmartDublinAdapter } from "../src/providers/smart-dublin";
import { createSourceRouter, type RuntimeDependencies } from "../src/runtime";

const RESOURCE_LIMITS = {
  maxInputBytes: 1_000_000,
  maxOutputBytes: 1_000_000,
};

function idleLoader(): ResourceLoader {
  return {
    async load() {
      throw new Error("Unexpected resource load");
    },
  };
}

describe("runtime composition", () => {
  it("registers every configured operation for all three named adapters", () => {
    const router = createSourceRouter({
      resourceLoader: idleLoader(),
      ...RESOURCE_LIMITS,
    });
    const expectedAdapters = {
      data_gov_ie: DataGovAdapter,
      smart_dublin: SmartDublinAdapter,
      met_eireann: MetEireannAdapter,
    } as const;

    for (const source of SOURCES) {
      const adapter = router.resolve(source, "search_datasets");
      expect(adapter).toBeInstanceOf(expectedAdapters[source]);
      expect(adapter.config).toBe(providerConfigs[source]);

      for (const operation of PROVIDER_OPERATIONS) {
        expect(router.resolve(source, operation)).toBe(adapter);
      }
    }
  });

  it("keeps the configured Met Eireann catalogue scope", () => {
    const router = createSourceRouter({
      resourceLoader: idleLoader(),
      ...RESOURCE_LIMITS,
    });

    expect(
      router.resolve("met_eireann", "search_datasets").config.scope,
    ).toEqual({
      organization_name: "meteireann",
      organization_id: "met-eireann",
    });
  });

  it("injects fetch, resource loader, and clock dependencies", async () => {
    const fetchCalls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            id: "dataset-1",
            name: "dataset-one",
            title: "Dataset One",
            owner_org: "publisher",
            organization: { title: "Publisher" },
            resources: [
              {
                id: "resource-1",
                format: "JSON",
                url: "https://files.example.test/data.json",
                datastore_active: false,
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const loadCalls: ResourceLoadRequest[] = [];
    const resourceLoader: ResourceLoader = {
      async load(input) {
        loadCalls.push(input);
        return {
          data: [{ value: "unchanged" }],
          pagination: { limit: 3, offset: 2, returned: 1 },
        };
      },
    };
    const now = new Date("2026-10-04T13:00:00.000Z");
    const router = createSourceRouter({
      resourceLoader,
      ...RESOURCE_LIMITS,
      fetch: fetcher,
      now: () => now,
    });

    const result = await router
      .resolve("data_gov_ie", "get_resource")
      .getResource({
        dataset_id: "dataset-1",
        resource_id: "resource-1",
        limit: 3,
        offset: 2,
      });

    expect(fetchCalls).toHaveLength(1);
    expect(new URL(fetchCalls[0]!).pathname).toBe(
      "/api/3/action/package_show",
    );
    expect(loadCalls).toEqual([
      {
        url: "https://files.example.test/data.json",
        format: "json",
        limit: 3,
        offset: 2,
        timeout_ms: 10_000,
      },
    ]);
    expect(result.data).toEqual([{ value: "unchanged" }]);
    expect(result.provenance.retrieved_at).toBe(now.toISOString());
  });

  it("propagates configured resource limits into CKAN clients", async () => {
    const fetcher = (async () =>
      Response.json({
        success: true,
        result: { count: 0, results: [], padding: "x".repeat(100) },
      })) as typeof fetch;
    const router = createSourceRouter({
      resourceLoader: idleLoader(),
      fetch: fetcher,
      maxInputBytes: 20,
      maxOutputBytes: 1_000,
    });

    await expect(
      router.resolve("data_gov_ie", "search_datasets").searchDatasets({}),
    ).rejects.toMatchObject({ code: "RESOURCE_TOO_LARGE" });
  });

  it("fails immediately when the resource loader is missing", () => {
    expect(() =>
      createSourceRouter({
        resourceLoader: undefined,
      } as unknown as RuntimeDependencies),
    ).toThrow("A resource loader is required");
  });
});
