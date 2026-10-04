import type { ProviderConfig } from "../models";
import {
  CkanAdapter,
  type CkanAdapterDependencies,
} from "./ckan/index";

export class SmartDublinAdapter extends CkanAdapter {
  constructor(config: ProviderConfig, dependencies: CkanAdapterDependencies) {
    if (config.provider !== "smart_dublin") {
      throw new Error(
        "SmartDublinAdapter requires the smart_dublin configuration",
      );
    }
    super(config, dependencies);
  }
}
