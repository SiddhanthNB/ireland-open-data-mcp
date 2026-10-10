import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors";
import type { ResourceFormat } from "../src/models";
import { DirectResourceLoader } from "../src/resources";

const DEFAULT_OPTIONS = {
  maxInputBytes: 4_096,
  maxOutputBytes: 2_048,
};

function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as typeof fetch;
}

function chunkedResponse(
  chunks: readonly string[],
  options: ResponseInit = {},
  onCancel?: () => void,
): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk === undefined) {
          controller.close();
        } else {
          controller.enqueue(encoder.encode(chunk));
        }
      },
      cancel() {
        onCancel?.();
      },
    }),
    options,
  );
}

function loader(
  response: Response,
  options: Partial<typeof DEFAULT_OPTIONS> = {},
): DirectResourceLoader {
  return new DirectResourceLoader({
    fetch: fetchReturning(response),
    ...DEFAULT_OPTIONS,
    ...options,
  });
}

function request(
  format: ResourceFormat,
  overrides: Partial<{
    limit: number;
    offset: number;
    timeout_ms: number;
  }> = {},
) {
  return {
    url: `https://files.example.test/data.${format}`,
    format,
    limit: 10,
    offset: 0,
    timeout_ms: 1_000,
    ...overrides,
  };
}

async function expectCode(
  promise: Promise<unknown>,
  code: AppError["code"],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("DirectResourceLoader", () => {
  it("parses quoted and multiline CSV safely and stops after the requested page", async () => {
    let cancelled = false;
    const response = chunkedResponse(
      [
        "name,notes\r\n\"Alpha\",\"line 1\n",
        "line 2\"\r\n\"Beta\",\"said \"\"hello\"\"\"\r\n",
        "Gamma,unread\r\n",
      ],
      {},
      () => {
        cancelled = true;
      },
    );

    const result = await loader(response).load(
      request("csv", { limit: 1, offset: 1 }),
    );

    expect(result).toEqual({
      data: [{ name: "Beta", notes: 'said "hello"' }],
      pagination_supported: true,
      pagination: { limit: 1, offset: 1, returned: 1 },
    });
    expect(cancelled).toBe(true);
  });

  it("returns CSV total when it reaches the end and handles large offsets", async () => {
    const result = await loader(
      chunkedResponse(["id,value\n1,one\n2,two\n"]),
    ).load(request("csv", { limit: 5, offset: 1_000_000 }));

    expect(result).toEqual({
      data: [],
      pagination_supported: true,
      pagination: {
        limit: 5,
        offset: 1_000_000,
        returned: 0,
        total: 2,
      },
    });
  });

  it("paginates top-level JSON arrays", async () => {
    const result = await loader(
      new Response(JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }])),
    ).load(request("json", { limit: 1, offset: 1 }));

    expect(result).toEqual({
      data: [{ id: 2 }],
      pagination_supported: true,
      pagination: { limit: 1, offset: 1, returned: 1, total: 3 },
    });
  });

  it("returns non-array JSON without fake pagination", async () => {
    const document = { records: [{ id: 1 }, { id: 2 }] };
    const result = await loader(
      new Response(JSON.stringify(document)),
    ).load(request("json", { limit: 1, offset: 1 }));

    expect(result).toEqual({ data: document, pagination_supported: false });
    expect(result.pagination).toBeUndefined();
  });

  it("returns XML as raw text without fake pagination", async () => {
    const xml = "<?xml version=\"1.0\"?><records><id>1</id></records>";
    const result = await loader(new Response(xml)).load(
      request("xml", { limit: 1, offset: 99 }),
    );

    expect(result).toEqual({ data: xml, pagination_supported: false });
    expect(result.pagination).toBeUndefined();
  });

  it("allows exact input and output byte boundaries", async () => {
    const body = '["é"]';
    const inputBytes = new TextEncoder().encode(body).byteLength;
    const outputBytes = new TextEncoder().encode(JSON.stringify(["é"])).byteLength;
    const result = await loader(
      new Response(body, { headers: { "content-length": String(inputBytes) } }),
      { maxInputBytes: inputBytes, maxOutputBytes: outputBytes },
    ).load(request("json"));

    expect(result.data).toEqual(["é"]);
  });

  it("rejects Content-Length above the input limit before reading", async () => {
    let cancelled = false;
    const response = chunkedResponse(
      ["{}"],
      { headers: { "content-length": "5" } },
      () => {
        cancelled = true;
      },
    );

    await expectCode(
      loader(response, { maxInputBytes: 4 }).load(request("json")),
      "RESOURCE_TOO_LARGE",
    );
    expect(cancelled).toBe(true);
  });

  it("streams a small CSV page despite a large upstream Content-Length", async () => {
    let cancelled = false;
    const response = chunkedResponse(
      ["id,value\n1,one\n", "2,two\n3,three\n"],
      { headers: { "content-length": "1000000" } },
      () => {
        cancelled = true;
      },
    );

    const result = await loader(response, { maxInputBytes: 20 }).load(
      request("csv", { limit: 1 }),
    );

    expect(result).toEqual({
      data: [{ id: "1", value: "one" }],
      pagination_supported: true,
      pagination: { limit: 1, offset: 0, returned: 1 },
    });
    expect(cancelled).toBe(true);
  });

  it("enforces actual streamed bytes when Content-Length is absent", async () => {
    await expectCode(
      loader(chunkedResponse(["[1,", "2,3]"]), {
        maxInputBytes: 4,
      }).load(request("json")),
      "RESOURCE_TOO_LARGE",
    );
  });

  it("rejects serialized output above the output limit", async () => {
    const body = '["é"]';
    const outputBytes = new TextEncoder().encode(JSON.stringify(["é"])).byteLength;

    await expectCode(
      loader(new Response(body), { maxOutputBytes: outputBytes - 1 }).load(
        request("json"),
      ),
      "RESOURCE_TOO_LARGE",
    );
  });

  it("enforces output limits for CSV and XML", async () => {
    await expectCode(
      loader(new Response("id,value\n1,a long value\n"), {
        maxOutputBytes: 10,
      }).load(request("csv")),
      "RESOURCE_TOO_LARGE",
    );
    await expectCode(
      loader(new Response("<root>a long value</root>"), {
        maxOutputBytes: 10,
      }).load(request("xml")),
      "RESOURCE_TOO_LARGE",
    );
  });

  it("bounds CSV scans for large offsets", async () => {
    await expectCode(
      loader(chunkedResponse(["id\n", "1\n", "2\n", "3\n"]), {
        maxInputBytes: 5,
      }).load(request("csv", { offset: 1_000_000 })),
      "RESOURCE_TOO_LARGE",
    );
  });

  it("maps a stalled response body to a timeout", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
    );

    await expectCode(
      loader(response).load(request("json", { timeout_ms: 10 })),
      "UPSTREAM_TIMEOUT",
    );
    expect(cancelled).toBe(true);
  });

  it("applies the timeout while waiting for response headers", async () => {
    const stalledFetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const direct = new DirectResourceLoader({
      fetch: stalledFetch,
      ...DEFAULT_OPTIONS,
    });

    await expectCode(
      direct.load(request("json", { timeout_ms: 10 })),
      "UPSTREAM_TIMEOUT",
    );
  });

  it("maps HTTP 429 and other non-success responses", async () => {
    await expectCode(
      loader(new Response("slow down", { status: 429 })).load(request("json")),
      "RATE_LIMITED",
    );
    await expectCode(
      loader(new Response("bad gateway", { status: 502 })).load(request("json")),
      "UPSTREAM_ERROR",
    );
  });

  it("rejects invalid JSON and malformed CSV", async () => {
    await expectCode(
      loader(new Response("{not-json")).load(request("json")),
      "UPSTREAM_ERROR",
    );
    await expectCode(
      loader(new Response('name,notes\nitem,"unterminated')).load(
        request("csv"),
      ),
      "UPSTREAM_ERROR",
    );
  });

  it("rejects unsupported formats and invalid pagination", async () => {
    let fetched = false;
    const direct = new DirectResourceLoader({
      fetch: (async () => {
        fetched = true;
        return new Response("payload");
      }) as typeof fetch,
      ...DEFAULT_OPTIONS,
    });
    await expectCode(
      direct.load({
        ...request("json"),
        format: "pdf" as ResourceFormat,
      }),
      "UNSUPPORTED_FORMAT",
    );
    expect(fetched).toBe(false);
    await expectCode(
      loader(new Response("[]")).load(request("json", { limit: 0 })),
      "INVALID_REQUEST",
    );
  });

  it("validates constructor limits", () => {
    expect(
      () =>
        new DirectResourceLoader({
          fetch: fetchReturning(new Response("[]")),
          maxInputBytes: 0,
          maxOutputBytes: 1,
        }),
    ).toThrow(RangeError);
  });
});
