import { describe, expect, it } from "vitest";

import {
  getProviderConfig,
  loadProviderConfigs,
  parseProviderConfig,
  providerConfigs,
  ProviderConfigError,
} from "../src/config";
import type { Source } from "../src/models";

function validConfig(provider: Source): string {
  const scope =
    provider === "met_eireann"
      ? `
scope:
  organization_name: meteireann
  organization_id: met-eireann`
      : "";

  return `
provider: ${provider}
base_url: https://example.test
endpoints:
  package_search: /api/3/action/package_search
  package_show: /api/3/action/package_show
  datastore_search: /api/3/action/datastore_search
http_timeout_ms: 10000
pagination:
  default_limit: 10
  max_limit: 100
capabilities:
  search_datasets: true
  get_dataset: true
  get_resource: true
formats:
  - csv
  - json
  - xml${scope}
`;
}

function allDocuments() {
  return [
    {
      expectedProvider: "data_gov_ie" as const,
      contents: validConfig("data_gov_ie"),
    },
    {
      expectedProvider: "smart_dublin" as const,
      contents: validConfig("smart_dublin"),
    },
    {
      expectedProvider: "met_eireann" as const,
      contents: validConfig("met_eireann"),
    },
  ];
}

describe("provider configuration", () => {
  it("loads the three bundled provider configurations", () => {
    expect(Object.keys(providerConfigs)).toEqual([
      "data_gov_ie",
      "smart_dublin",
      "met_eireann",
    ]);
    expect(getProviderConfig("data_gov_ie")).toMatchObject({
      base_url: "https://data.gov.ie",
      http_timeout_ms: 10_000,
      pagination: { default_limit: 10, max_limit: 100 },
    });
    expect(getProviderConfig("smart_dublin").base_url).toBe(
      "https://data.smartdublin.ie",
    );
    expect(getProviderConfig("met_eireann").scope).toEqual({
      organization_name: "meteireann",
      organization_id: "met-eireann",
    });
  });

  it("returns deeply immutable configuration", () => {
    const config = getProviderConfig("data_gov_ie");

    expect(Object.isFrozen(providerConfigs)).toBe(true);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.endpoints)).toBe(true);
    expect(Object.isFrozen(config.pagination)).toBe(true);
    expect(Object.isFrozen(config.capabilities)).toBe(true);
    expect(Object.isFrozen(config.formats)).toBe(true);
  });

  it("rejects invalid YAML", () => {
    expect(() => parseProviderConfig("provider: [", "data_gov_ie")).toThrow(
      new ProviderConfigError("Invalid YAML for provider data_gov_ie"),
    );
  });

  it("rejects invalid or unknown schema fields", () => {
    const invalid = `${validConfig("data_gov_ie")}unknown: true\n`;

    expect(() => parseProviderConfig(invalid, "data_gov_ie")).toThrow(
      /Invalid configuration for provider data_gov_ie/,
    );
  });

  it("rejects protocol-relative endpoint paths", () => {
    const invalid = validConfig("data_gov_ie").replace(
      "/api/3/action/package_search",
      "//other-host/package_search",
    );

    expect(() => parseProviderConfig(invalid, "data_gov_ie")).toThrow(
      /endpoint paths must start with exactly one slash/,
    );
  });

  it("rejects a provider that does not match its expected source", () => {
    expect(() =>
      parseProviderConfig(validConfig("smart_dublin"), "data_gov_ie"),
    ).toThrow(
      "Provider mismatch: expected data_gov_ie, received smart_dublin",
    );
  });

  it("rejects duplicate provider documents", () => {
    const documents = allDocuments();
    documents.push({
      expectedProvider: "data_gov_ie",
      contents: validConfig("data_gov_ie"),
    });

    expect(() => loadProviderConfigs(documents)).toThrow(
      "Duplicate configuration for provider data_gov_ie",
    );
  });

  it("rejects incomplete provider document sets", () => {
    expect(() => loadProviderConfigs(allDocuments().slice(0, 2))).toThrow(
      "Missing configuration for provider(s): met_eireann",
    );
  });
});
