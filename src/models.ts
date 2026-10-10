export const SOURCES = [
  "data_gov_ie",
  "smart_dublin",
  "met_eireann",
] as const;

export type Source = (typeof SOURCES)[number];

export const PROVIDER_OPERATIONS = [
  "search_datasets",
  "get_dataset",
  "get_resource",
] as const;

export type ProviderOperation = (typeof PROVIDER_OPERATIONS)[number];

export type ResourceFormat = "csv" | "json" | "xml";

export interface ProviderCapabilities {
  search_datasets: boolean;
  get_dataset: boolean;
  get_resource: boolean;
}

export interface ProviderConfig {
  provider: Source;
  base_url: string;
  endpoints: Readonly<Record<string, string>>;
  http_timeout_ms: number;
  pagination: {
    default_limit: number;
    max_limit: number;
  };
  capabilities: ProviderCapabilities;
  formats: readonly ResourceFormat[];
  scope?: {
    organization_name: string;
    organization_id: string;
  };
}

export interface Provenance {
  source: Source;
  upstream_url: string;
  retrieved_at: string;
  original_format?: string;
}

export interface Pagination {
  limit: number;
  offset: number;
  returned: number;
  total?: number;
}

export interface DatasetSummary {
  dataset_id: string;
  title: string;
  description?: string;
  publisher?: string;
  available_formats?: readonly string[];
  provenance: Provenance;
}

export interface ResourceSummary {
  resource_id: string;
  title?: string;
  description?: string;
  format: string;
  supported: boolean;
  size?: number;
  last_modified?: string;
  datastore_active?: boolean;
  upstream_url: string;
}

export interface Dataset extends DatasetSummary {
  licence?: string;
  tags?: readonly string[];
  resources: readonly ResourceSummary[];
}

export interface Resource {
  dataset_id?: string;
  resource_id: string;
  data: unknown;
  provenance: Provenance & { original_format: string };
  pagination_supported: boolean;
  pagination?: Pagination;
}

export interface DatasetSearchResult {
  datasets: readonly DatasetSummary[];
  pagination: Pagination;
}

export function isSource(value: string): value is Source {
  return SOURCES.some((source) => source === value);
}
