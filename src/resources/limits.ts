import { AppError } from "../errors";

export function enforceSerializedSize(value: unknown, maxBytes: number): void {
  const serialized = JSON.stringify(value);
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > maxBytes
  ) {
    throw new AppError("RESOURCE_TOO_LARGE");
  }
}

export async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (contentLengthExceeds(response, maxBytes)) {
    cancelBody(response.body);
    throw new AppError("RESOURCE_TOO_LARGE");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new AppError("UPSTREAM_ERROR");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) {
        reader.releaseLock();
        text += decoder.decode();
        break;
      }

      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        cancelReader(reader);
        throw new AppError("RESOURCE_TOO_LARGE");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("UPSTREAM_ERROR");
  }
}

export function contentLengthExceeds(
  response: Response,
  maxBytes: number,
): boolean {
  const value = response.headers.get("content-length")?.trim();
  if (!value || !/^\d+$/.test(value)) {
    return false;
  }
  return BigInt(value) > BigInt(maxBytes);
}

export function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body) {
    void body.cancel().catch(() => undefined);
  }
}

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  void reader.cancel().catch(() => undefined);
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}
