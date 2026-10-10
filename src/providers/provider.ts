import type {
  Dataset,
  DatasetSearchResult,
  ProviderConfig,
  Resource,
} from "../models";

export interface SearchDatasetsInput {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface GetDatasetInput {
  dataset_id: string;
}

export interface GetResourceInput {
  dataset_id: string;
  resource_id: string;
  limit?: number;
  offset?: number;
}

export interface ProviderAdapter {
  readonly config: ProviderConfig;

  searchDatasets(input: SearchDatasetsInput): Promise<DatasetSearchResult>;
  getDataset(input: GetDatasetInput): Promise<Dataset>;
  getResource(input: GetResourceInput): Promise<Resource>;
}
