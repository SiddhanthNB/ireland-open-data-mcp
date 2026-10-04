import type { ProviderConfig } from "../models";
import {
  CkanAdapter,
  type CkanAdapterDependencies,
} from "./ckan/index";

export class MetEireannAdapter extends CkanAdapter {
  constructor(config: ProviderConfig, dependencies: CkanAdapterDependencies) {
    if (config.provider !== "met_eireann") {
      throw new Error(
        "MetEireannAdapter requires the met_eireann configuration",
      );
    }
    if (!config.scope?.organization_name || !config.scope.organization_id) {
      throw new Error(
        "MetEireannAdapter requires organization scope configuration",
      );
    }
    super(config, dependencies);
  }
}
