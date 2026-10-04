import { providerConfigs } from "./config/index";
import { DataGovAdapter } from "./providers/data-gov-ie";
import {
  type CkanAdapterDependencies,
  type ResourceLoader,
} from "./providers/ckan/index";
import { MetEireannAdapter } from "./providers/met-eireann";
import { SmartDublinAdapter } from "./providers/smart-dublin";
import { SourceRouter } from "./router";

export interface RuntimeDependencies {
  resourceLoader: ResourceLoader;
  maxInputBytes: number;
  maxOutputBytes: number;
  fetch?: typeof fetch;
  now?: () => Date;
}

export function createSourceRouter(
  dependencies: RuntimeDependencies,
): SourceRouter {
  if (typeof dependencies?.resourceLoader?.load !== "function") {
    throw new Error("A resource loader is required");
  }

  const adapterDependencies: CkanAdapterDependencies = {
    resourceLoader: dependencies.resourceLoader,
    maxInputBytes: dependencies.maxInputBytes,
    maxOutputBytes: dependencies.maxOutputBytes,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    ...(dependencies.now ? { now: dependencies.now } : {}),
  };

  return new SourceRouter([
    new DataGovAdapter(providerConfigs.data_gov_ie, adapterDependencies),
    new SmartDublinAdapter(providerConfigs.smart_dublin, adapterDependencies),
    new MetEireannAdapter(providerConfigs.met_eireann, adapterDependencies),
  ]);
}
