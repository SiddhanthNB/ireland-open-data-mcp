import type { ProviderConfig } from "../models";
import {
  CkanAdapter,
  type CkanAdapterDependencies,
} from "./ckan/index";

export class DataGovAdapter extends CkanAdapter {
  constructor(config: ProviderConfig, dependencies: CkanAdapterDependencies) {
    if (config.provider !== "data_gov_ie") {
      throw new Error("DataGovAdapter requires the data_gov_ie configuration");
    }
    super(config, dependencies);
  }
}
