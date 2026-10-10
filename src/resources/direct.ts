import { AppError } from "../errors";
import type { Pagination, ResourceFormat } from "../models";
import type {
  ResourceLoader,
  ResourceLoadRequest,
  ResourceLoadResult,
} from "../providers/ckan";
import {
  abortable,
  cancelBody,
  contentLengthExceeds,
  enforceSerializedSize,
} from "./limits";

export interface DirectResourceLoaderOptions {
  fetch?: typeof fetch;
  maxInputBytes: number;
  maxOutputBytes: number;
}

export class DirectResourceLoader implements ResourceLoader {
  private readonly fetcher: typeof fetch;
  private readonly maxInputBytes: number;
  private readonly maxOutputBytes: number;

  constructor(options: DirectResourceLoaderOptions) {
    requirePositiveInteger(options.maxInputBytes, "maxInputBytes");
    requirePositiveInteger(options.maxOutputBytes, "maxOutputBytes");

    const fetcher = options.fetch ?? fetch;
    this.fetcher = (input, init) => fetcher(input, init);
    this.maxInputBytes = options.maxInputBytes;
    this.maxOutputBytes = options.maxOutputBytes;
  }

  async load(input: ResourceLoadRequest): Promise<ResourceLoadResult> {
    validateRequest(input);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeout_ms);

    try {
      const response = await abortable(
        this.fetcher(input.url, {
          headers: { accept: acceptHeader(input.format) },
          signal: controller.signal,
        }),
        controller.signal,
      );

      if (response.status === 429) {
        cancelBody(response.body);
        throw new AppError("RATE_LIMITED");
      }
      if (!response.ok) {
        cancelBody(response.body);
        throw new AppError("UPSTREAM_ERROR");
      }

      if (
        input.format !== "csv" &&
        contentLengthExceeds(response, this.maxInputBytes)
      ) {
        cancelBody(response.body);
        throw new AppError("RESOURCE_TOO_LARGE");
      }

      const body = new BoundedBodyReader(
        response.body,
        this.maxInputBytes,
        controller.signal,
      );

      switch (input.format) {
        case "csv":
          return await loadCsv(
            body,
            input.limit,
            input.offset,
            this.maxOutputBytes,
          );
        case "json":
          return await loadJson(
            body,
            input.limit,
            input.offset,
            this.maxOutputBytes,
          );
        case "xml":
          return await loadXml(body, this.maxOutputBytes);
        default:
          body.cancel();
          throw new AppError("UNSUPPORTED_FORMAT");
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
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

class BoundedBodyReader {
  private readonly reader?: ReadableStreamDefaultReader<Uint8Array>;
  private bytesRead = 0;
  private finished = false;

  constructor(
    body: ReadableStream<Uint8Array> | null,
    private readonly maxBytes: number,
    private readonly signal: AbortSignal,
  ) {
    this.reader = body?.getReader();
  }

  async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (!this.reader || this.finished) {
      return { done: true, value: undefined };
    }

    const result = await abortable(this.reader.read(), this.signal);
    if (result.done) {
      this.finished = true;
      this.reader.releaseLock();
      return result;
    }

    this.bytesRead += result.value.byteLength;
    if (this.bytesRead > this.maxBytes) {
      this.cancel();
      throw new AppError("RESOURCE_TOO_LARGE");
    }
    return result;
  }

  cancel(): void {
    if (!this.reader || this.finished) {
      return;
    }
    this.finished = true;
    void this.reader.cancel().catch(() => undefined);
  }
}

async function loadJson(
  body: BoundedBodyReader,
  limit: number,
  offset: number,
  maxOutputBytes: number,
): Promise<ResourceLoadResult> {
  const contents = await readText(body);
  let document: unknown;
  try {
    document = JSON.parse(contents);
  } catch {
    throw new AppError("UPSTREAM_ERROR");
  }

  if (!Array.isArray(document)) {
    enforceSerializedSize(document, maxOutputBytes);
    return { data: document, pagination_supported: false };
  }

  const data = document.slice(offset, offset + limit);
  enforceSerializedSize(data, maxOutputBytes);
  return {
    data,
    pagination_supported: true,
    pagination: {
      limit,
      offset,
      returned: data.length,
      total: document.length,
    },
  };
}

async function loadXml(
  body: BoundedBodyReader,
  maxOutputBytes: number,
): Promise<ResourceLoadResult> {
  const data = await readText(body);
  enforceSerializedSize(data, maxOutputBytes);
  return { data, pagination_supported: false };
}

async function loadCsv(
  body: BoundedBodyReader,
  limit: number,
  offset: number,
  maxOutputBytes: number,
): Promise<ResourceLoadResult> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const rows: Array<Record<string, string>> = [];
  let headers: string[] | undefined;
  let dataRowCount = 0;
  let reachedEnd = false;

  const parser = new CsvParser((row) => {
    if (!headers) {
      headers = validateHeaders(row);
      return true;
    }

    const currentIndex = dataRowCount++;
    if (currentIndex < offset) {
      return true;
    }

    if (row.length !== headers.length) {
      throw new AppError("UPSTREAM_ERROR");
    }

    const record: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index]!] = row[index]!;
    }
    rows.push(record);
    enforceSerializedSize(rows, maxOutputBytes);
    return rows.length < limit;
  });

  try {
    while (!parser.stopped) {
      const chunk = await body.read();
      if (chunk.done) {
        reachedEnd = true;
        parser.finish();
        break;
      }
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }

    if (parser.stopped) {
      body.cancel();
    } else {
      parser.feed(decoder.decode());
    }
  } catch (error) {
    body.cancel();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("UPSTREAM_ERROR");
  }

  if (!headers) {
    throw new AppError("UPSTREAM_ERROR");
  }
  enforceSerializedSize(rows, maxOutputBytes);

  const pagination: Pagination = {
    limit,
    offset,
    returned: rows.length,
    ...(reachedEnd ? { total: dataRowCount } : {}),
  };
  return { data: rows, pagination_supported: true, pagination };
}

class CsvParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private afterQuote = false;
  private skipLineFeed = false;
  private hasInput = false;
  stopped = false;

  constructor(private readonly onRow: (row: string[]) => boolean) {}

  feed(contents: string): void {
    for (const character of contents) {
      if (this.stopped) {
        return;
      }
      this.hasInput = true;

      if (this.skipLineFeed) {
        this.skipLineFeed = false;
        if (character === "\n") {
          continue;
        }
      }

      if (this.inQuotes) {
        if (character === '"') {
          this.inQuotes = false;
          this.afterQuote = true;
        } else {
          this.field += character;
        }
        continue;
      }

      if (this.afterQuote) {
        if (character === '"') {
          this.field += '"';
          this.inQuotes = true;
          this.afterQuote = false;
          continue;
        }
        this.afterQuote = false;
        if (character === ",") {
          this.endField();
          continue;
        }
        if (character === "\n" || character === "\r") {
          this.endRow();
          this.skipLineFeed = character === "\r";
          continue;
        }
        throw new AppError("UPSTREAM_ERROR");
      }

      if (character === '"') {
        if (this.field.length > 0) {
          throw new AppError("UPSTREAM_ERROR");
        }
        this.inQuotes = true;
      } else if (character === ",") {
        this.endField();
      } else if (character === "\n" || character === "\r") {
        this.endRow();
        this.skipLineFeed = character === "\r";
      } else {
        this.field += character;
      }
    }
  }

  finish(): void {
    if (this.inQuotes) {
      throw new AppError("UPSTREAM_ERROR");
    }
    if (this.field.length > 0 || this.row.length > 0 || this.afterQuote) {
      this.afterQuote = false;
      this.endRow();
    } else if (!this.hasInput) {
      return;
    }
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = "";
  }

  private endRow(): void {
    this.endField();
    const row = this.row;
    this.row = [];
    if (!this.onRow(row)) {
      this.stopped = true;
    }
  }
}

async function readText(body: BoundedBodyReader): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = "";
  try {
    while (true) {
      const chunk = await body.read();
      if (chunk.done) {
        return result + decoder.decode();
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    body.cancel();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("UPSTREAM_ERROR");
  }
}

function validateHeaders(row: string[]): string[] {
  const normalized = row.map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, "") : header,
  );
  if (
    normalized.length === 0 ||
    normalized.some((header) => header.length === 0) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new AppError("UPSTREAM_ERROR");
  }
  return normalized;
}

function validateRequest(input: ResourceLoadRequest): void {
  if (
    input.format !== "csv" &&
    input.format !== "json" &&
    input.format !== "xml"
  ) {
    throw new AppError("UNSUPPORTED_FORMAT");
  }
  if (
    !Number.isInteger(input.limit) ||
    input.limit <= 0 ||
    !Number.isInteger(input.offset) ||
    input.offset < 0 ||
    !Number.isInteger(input.timeout_ms) ||
    input.timeout_ms <= 0
  ) {
    throw new AppError("INVALID_REQUEST");
  }
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function acceptHeader(format: ResourceFormat): string {
  switch (format) {
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "xml":
      return "application/xml, text/xml;q=0.9";
    default:
      return "*/*";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
