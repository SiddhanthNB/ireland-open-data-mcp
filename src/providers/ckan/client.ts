import { AppError, type ErrorCode } from "../../errors";
import type { ProviderConfig } from "../../models";
import {
  abortable,
  cancelBody,
  readBoundedJsonResponse,
} from "../../resources/limits";

export type CkanRecord = Record<string, unknown>;

interface CkanEnvelope {
  success: boolean;
  result?: unknown;
  error?: unknown;
}

export class CkanClient {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly config: ProviderConfig,
    fetcher: typeof fetch,
    private readonly maxInputBytes: number,
  ) {
    this.fetcher = (input, init) => fetcher(input, init);
  }

  packageSearch(parameters: URLSearchParams): Promise<CkanRecord> {
    return this.request("package_search", parameters, undefined, true);
  }

  packageShow(datasetId: string): Promise<CkanRecord> {
    return this.request(
      "package_show",
      new URLSearchParams({ id: datasetId }),
      "DATASET_NOT_FOUND",
    );
  }

  datastoreSearch(parameters: URLSearchParams): Promise<CkanRecord> {
    return this.request("datastore_search", parameters);
  }

  endpointUrl(endpoint: string, parameters: URLSearchParams): string {
    const path = this.config.endpoints[endpoint];
    if (!path) {
      throw new Error(`Missing CKAN endpoint: ${endpoint}`);
    }

    const baseUrl = this.config.base_url.endsWith("/")
      ? this.config.base_url
      : `${this.config.base_url}/`;
    const url = new URL(path, baseUrl);
    url.search = parameters.toString();
    return url.toString();
  }

  private async request(
    endpoint: string,
    parameters: URLSearchParams,
    notFoundCode?: ErrorCode,
    searchRequest = false,
  ): Promise<CkanRecord> {
    const url = this.endpointUrl(endpoint, parameters);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.http_timeout_ms,
    );

    try {
      const response = await abortable(
        this.fetcher(url, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        }),
        controller.signal,
      );

      if (response.status === 429) {
        cancelBody(response.body);
        throw new AppError("RATE_LIMITED");
      }
      if (response.status === 404 && notFoundCode) {
        cancelBody(response.body);
        throw new AppError(notFoundCode);
      }
      if (
        searchRequest &&
        (response.status === 400 || response.status === 409)
      ) {
        const body = await readBoundedJsonResponse(
          response,
          this.maxInputBytes,
          controller.signal,
        );
        const envelope = parseEnvelope(body);
        if (!envelope.success && isSearchError(envelope.error)) {
          throw invalidSearchQuery();
        }
        throw new AppError("UPSTREAM_ERROR");
      }
      if (!response.ok) {
        cancelBody(response.body);
        throw new AppError("UPSTREAM_ERROR");
      }

      const body = await readBoundedJsonResponse(
        response,
        this.maxInputBytes,
        controller.signal,
      );

      const envelope = parseEnvelope(body);
      if (!envelope.success) {
        if (notFoundCode && isNotFoundError(envelope.error)) {
          throw new AppError(notFoundCode);
        }
        if (searchRequest && isSearchError(envelope.error)) {
          throw invalidSearchQuery();
        }
        throw new AppError("UPSTREAM_ERROR");
      }
      if (!isRecord(envelope.result)) {
        throw new AppError("UPSTREAM_ERROR");
      }

      return envelope.result;
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new AppError("UPSTREAM_TIMEOUT");
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("UPSTREAM_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function isRecord(value: unknown): value is CkanRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelope(value: unknown): CkanEnvelope {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new AppError("UPSTREAM_ERROR");
  }

  if (value.success) {
    if (!("result" in value) || "error" in value) {
      throw new AppError("UPSTREAM_ERROR");
    }
    return { success: true, result: value.result };
  }

  if (!("error" in value) || "result" in value) {
    throw new AppError("UPSTREAM_ERROR");
  }
  return { success: false, error: value.error };
}

function isNotFoundError(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const type = value.__type;
  return typeof type === "string" && type.toLowerCase().includes("not found");
}

function isSearchError(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const type = value.__type;
  return (
    typeof type === "string" && type.trim().toLowerCase() === "search error"
  );
}

function invalidSearchQuery(): AppError {
  return new AppError("INVALID_REQUEST", "The search query is invalid.");
}
