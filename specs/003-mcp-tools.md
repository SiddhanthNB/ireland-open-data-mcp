# MCP Tools

## Overview

Ireland Open Data MCP exposes a small generic toolset.

The tools are provider-independent.

Supported sources:

- `data_gov_ie`
- `smart_dublin`
- `met_eireann`

The MCP layer must not expose provider-specific tools.

The tools are registered on the official MCP TypeScript server and exposed through the Cloudflare Agents SDK stateless handler.

The public transport is Streamable HTTP at `/mcp`. Each request receives a fresh server instance and must not depend on in-memory session state.

## 1. search_datasets

Search datasets within one provider.

### Inputs

- `source` — required
- `query` — optional keyword search
- `limit` — optional
- `offset` — optional

### Example

    search_datasets(
      source="smart_dublin",
      query="traffic",
      limit=10
    )

### Response

Should include:

- source
- dataset ID
- title
- description where available
- publisher where available
- available formats where available
- upstream URL
- retrieval timestamp

No interpretation or ranking beyond what the upstream provider already returns.

---

## 2. get_dataset

Retrieve metadata for one dataset.

### Inputs

- `source` — required
- `dataset_id` — required

### Response

Should include:

- dataset ID
- title
- description
- publisher
- licence where available
- tags where available
- available resources
- upstream URL
- retrieval timestamp

Resources should include enough information for a client to request them through `get_resource`.

---

## 3. get_resource

Retrieve data from a specific dataset resource.

### Inputs

- `source` — required
- `dataset_id` — required where applicable
- `resource_id` — required
- `limit` — optional
- `offset` — optional

Provider adapters may internally resolve resource IDs differently.

### Response

Should include:

- source
- dataset ID where available
- resource ID
- original format
- upstream URL
- retrieval timestamp
- returned data
- pagination metadata where applicable

The resource may be converted into a structured representation such as JSON.

The meaning of the underlying data must not be changed.

---

## Source Parameter

`source` is a fixed enum:

- `data_gov_ie`
- `smart_dublin`
- `met_eireann`

Unknown sources must return:

`INVALID_SOURCE`

---

## Limits

Tools should support limits to prevent excessively large responses.

Each provider may define:

- default limit
- maximum limit

These values come from provider configuration.

Requests exceeding the maximum should be capped or rejected consistently.

---

## Pagination

Where supported by the upstream provider, pagination should use:

- `limit`
- `offset`

Provider-specific pagination mechanisms must remain hidden inside adapters.

---

## Resource Formats

Initial supported resource formats may include:

- CSV
- JSON
- XML

Resource handlers may convert these into structured JSON responses.

Unsupported formats return:

`UNSUPPORTED_FORMAT`

---

## Standard Response Metadata

Responses should include provenance where available:

- `source`
- `upstream_url`
- `retrieved_at`
- `original_format`

Dataset and resource identifiers should also be included where applicable.

---

## Standard Errors

The MCP server should use consistent error codes.

Initial error codes:

- `INVALID_SOURCE`
- `INVALID_REQUEST`
- `DATASET_NOT_FOUND`
- `RESOURCE_NOT_FOUND`
- `UNSUPPORTED_OPERATION`
- `UNSUPPORTED_FORMAT`
- `UPSTREAM_ERROR`
- `UPSTREAM_TIMEOUT`
- `RATE_LIMITED`

Error shape:

    {
      "error": "RESOURCE_NOT_FOUND",
      "message": "The requested resource could not be found."
    }

---

## Design Rules

- Tools remain generic.
- One tool call targets one provider.
- No cross-source queries.
- No joins.
- No analytics.
- No derived insights.
- No recommendations.
- No write operations.
- No provider-specific MCP tools.
- Format conversion is allowed.
- Semantic transformation is not.
