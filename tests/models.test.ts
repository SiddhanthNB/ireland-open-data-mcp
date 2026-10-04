import { describe, expect, it } from "vitest";

import { isSource, PROVIDER_OPERATIONS, SOURCES } from "../src/models";

describe("shared models", () => {
  it("defines the fixed sources", () => {
    expect(SOURCES).toEqual([
      "data_gov_ie",
      "smart_dublin",
      "met_eireann",
    ]);
    expect(isSource("smart_dublin")).toBe(true);
    expect(isSource("unknown")).toBe(false);
  });

  it("defines the generic provider operations", () => {
    expect(PROVIDER_OPERATIONS).toEqual([
      "search_datasets",
      "get_dataset",
      "get_resource",
    ]);
  });
});
