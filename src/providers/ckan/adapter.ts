import { AppError } from "../../errors";
import type {
  Dataset,
  DatasetSearchResult,
  DatasetSummary,
  Pagination,
  ProviderConfig,
  Resource,
  ResourceFormat,
  ResourceSummary,
} from "../../models";
import type {
  GetDatasetInput,
  GetResourceInput,
  ProviderAdapter,
  SearchDatasetsInput,
} from "../provider";
import { enforceSerializedSize } from "../../resources/limits";
import { CkanClient, isRecord, type CkanRecord } from "./client";

export interface ResourceLoadRequest {
  url: string;
  format: ResourceFormat;
  limit: number;
  offset: number;
  timeout_ms: number;
}

export interface ResourceLoadResult {
  data: unknown;
  pagination?: Pagination;
}

export interface ResourceLoader {
  load(input: ResourceLoadRequest): Promise<ResourceLoadResult>;
}

export interface CkanAdapterDependencies {
  resourceLoader: ResourceLoader;
  maxInputBytes: number;
  maxOutputBytes: number;
  fetch?: typeof fetch;
  now?: () => Date;
}

export class CkanAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;

  private readonly client: CkanClient;
  private readonly resourceLoader: ResourceLoader;
  private readonly maxOutputBytes: number;
  private readonly now: () => Date;

  constructor(config: ProviderConfig, dependencies: CkanAdapterDependencies) {
    this.config = config;
    requirePositiveInteger(dependencies.maxInputBytes, "maxInputBytes");
    requirePositiveInteger(dependencies.maxOutputBytes, "maxOutputBytes");
    this.client = new CkanClient(
      config,
      dependencies.fetch ?? fetch,
      dependencies.maxInputBytes,
    );
    this.resourceLoader = dependencies.resourceLoader;
    this.maxOutputBytes = dependencies.maxOutputBytes;
    this.now = dependencies.now ?? (() => new Date());
  }

  async searchDatasets(
    input: SearchDatasetsInput,
  ): Promise<DatasetSearchResult> {
    const { limit, offset } = this.pagination(input.limit, input.offset);
    const parameters = new URLSearchParams({
      rows: String(limit),
      start: String(offset),
    });
    if (input.query !== undefined && input.query !== "") {
      parameters.set("q", input.query);
    }
    if (this.config.scope) {
      parameters.set(
        "fq",
        `organization:${this.config.scope.organization_name}`,
      );
    }

    const result = await this.client.packageSearch(parameters);
    const count = numberField(result, "count");
    const packages = arrayField(result, "results").map(recordValue);
    const datasets = packages
      .filter((dataset) => this.isInScope(dataset))
      .map((dataset) => this.mapDatasetSummary(dataset));

    return {
      datasets,
      pagination: {
        limit,
        offset,
        returned: datasets.length,
        total: count,
      },
    };
  }

  async getDataset(input: GetDatasetInput): Promise<Dataset> {
    const dataset = await this.client.packageShow(input.dataset_id);
    this.enforceScope(dataset);
    return this.mapDataset(dataset);
  }

  async getResource(input: GetResourceInput): Promise<Resource> {
    if (!input.dataset_id) {
      throw new AppError("INVALID_REQUEST");
    }

    const dataset = await this.client.packageShow(input.dataset_id);
    this.enforceScope(dataset);
    const resources = arrayField(dataset, "resources");
    const resource = resources
      .map(recordValue)
      .find((candidate) => stringField(candidate, "id") === input.resource_id);
    if (!resource) {
      throw new AppError("RESOURCE_NOT_FOUND");
    }

    const format = resourceFormat(resource.format);
    if (!format || !this.config.formats.includes(format)) {
      throw new AppError("UNSUPPORTED_FORMAT");
    }

    const { limit, offset } = this.pagination(input.limit, input.offset);
    const datasetId = stringField(dataset, "id");
    const resourceId = stringField(resource, "id");
    const resourceUrl = stringField(resource, "url");

    if (resource.datastore_active === true) {
      const parameters = new URLSearchParams({
        resource_id: resourceId,
        limit: String(limit),
        offset: String(offset),
      });
      const result = await this.client.datastoreSearch(parameters);
      const records = arrayField(result, "records");
      const total = numberField(result, "total");

      return this.boundedResource({
        dataset_id: datasetId,
        resource_id: resourceId,
        data: records,
        provenance: {
          source: this.config.provider,
          upstream_url: this.client.endpointUrl(
            "datastore_search",
            parameters,
          ),
          retrieved_at: this.now().toISOString(),
          original_format: format,
        },
        pagination: {
          limit,
          offset,
          returned: records.length,
          total,
        },
      });
    }

    let loaded: ResourceLoadResult;
    try {
      loaded = await this.resourceLoader.load({
        url: resourceUrl,
        format,
        limit,
        offset,
        timeout_ms: this.config.http_timeout_ms,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("UPSTREAM_ERROR");
    }

    return this.boundedResource({
      dataset_id: datasetId,
      resource_id: resourceId,
      data: loaded.data,
      provenance: {
        source: this.config.provider,
        upstream_url: resourceUrl,
        retrieved_at: this.now().toISOString(),
        original_format: format,
      },
      ...(loaded.pagination ? { pagination: loaded.pagination } : {}),
    });
  }

  private boundedResource(resource: Resource): Resource {
    enforceSerializedSize(resource, this.maxOutputBytes);
    return resource;
  }

  private mapDatasetSummary(dataset: CkanRecord): DatasetSummary {
    const resources = arrayField(dataset, "resources").map(recordValue);
    const formats = uniqueFormats(resources).filter((format) =>
      this.config.formats.includes(format),
    );
    const organization = optionalRecord(dataset.organization);

    return {
      dataset_id: stringField(dataset, "id"),
      title: optionalString(dataset.title) ?? stringField(dataset, "name"),
      ...(optionalString(dataset.notes)
        ? { description: optionalString(dataset.notes) }
        : {}),
      ...(organization && optionalString(organization.title)
        ? { publisher: optionalString(organization.title) }
        : {}),
      ...(formats.length > 0 ? { available_formats: formats } : {}),
      provenance: {
        source: this.config.provider,
        upstream_url: this.datasetUrl(dataset),
        retrieved_at: this.now().toISOString(),
      },
    };
  }

  private mapDataset(dataset: CkanRecord): Dataset {
    const summary = this.mapDatasetSummary(dataset);
    const resources = arrayField(dataset, "resources")
      .map(recordValue)
      .map(mapResourceSummary)
      .filter((resource): resource is ResourceSummary => resource !== undefined)
      .filter((resource) => this.config.formats.includes(resource.format));
    const tags = optionalArray(dataset.tags)?.map((tag) =>
      stringField(recordValue(tag), "name"),
    );

    return {
      ...summary,
      ...(optionalString(dataset.license_title)
        ? { licence: optionalString(dataset.license_title) }
        : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
      resources,
    };
  }

  private datasetUrl(dataset: CkanRecord): string {
    const id = stringField(dataset, "id");
    return this.client.endpointUrl(
      "package_show",
      new URLSearchParams({ id }),
    );
  }

  private enforceScope(dataset: CkanRecord): void {
    if (!this.isInScope(dataset)) {
      throw new AppError("DATASET_NOT_FOUND");
    }
  }

  private isInScope(dataset: CkanRecord): boolean {
    const requiredOwner = this.config.scope?.organization_id;
    return (
      requiredOwner === undefined ||
      optionalString(dataset.owner_org) === requiredOwner
    );
  }

  private pagination(
    requestedLimit: number | undefined,
    requestedOffset: number | undefined,
  ): { limit: number; offset: number } {
    const limit = requestedLimit ?? this.config.pagination.default_limit;
    const offset = requestedOffset ?? 0;
    if (
      !Number.isInteger(limit) ||
      limit <= 0 ||
      limit > this.config.pagination.max_limit ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new AppError("INVALID_REQUEST");
    }
    return { limit, offset };
  }
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function mapResourceSummary(resource: CkanRecord): ResourceSummary | undefined {
  const format = resourceFormat(resource.format);
  if (!format) {
    return undefined;
  }
  return {
    resource_id: stringField(resource, "id"),
    ...(optionalString(resource.name)
      ? { title: optionalString(resource.name) }
      : {}),
    ...(optionalString(resource.description)
      ? { description: optionalString(resource.description) }
      : {}),
    format,
    upstream_url: stringField(resource, "url"),
  };
}

function uniqueFormats(resources: readonly CkanRecord[]): ResourceFormat[] {
  return [
    ...new Set(
      resources
        .map((resource) => resourceFormat(resource.format))
        .filter((format): format is ResourceFormat => format !== undefined),
    ),
  ];
}

function resourceFormat(value: unknown): ResourceFormat | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "csv" || normalized.includes("text/csv")) {
    return "csv";
  }
  if (normalized === "json" || normalized.includes("json")) {
    return "json";
  }
  if (normalized === "xml" || normalized.includes("xml")) {
    return "xml";
  }
  return undefined;
}

function recordValue(value: unknown): CkanRecord {
  if (!isRecord(value)) {
    throw new AppError("UPSTREAM_ERROR");
  }
  return value;
}

function arrayField(record: CkanRecord, field: string): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new AppError("UPSTREAM_ERROR");
  }
  return value;
}

function optionalArray(value: unknown): unknown[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new AppError("UPSTREAM_ERROR");
  }
  return value;
}

function stringField(record: CkanRecord, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("UPSTREAM_ERROR");
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new AppError("UPSTREAM_ERROR");
  }
  return value;
}

function numberField(record: CkanRecord, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AppError("UPSTREAM_ERROR");
  }
  return value;
}

function optionalRecord(value: unknown): CkanRecord | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return recordValue(value);
}
