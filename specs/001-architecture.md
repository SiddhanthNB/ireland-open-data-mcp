# Architecture

## Overview

Ireland Open Data MCP uses a layered architecture so MCP clients remain independent from the implementation details of each public-data provider.

The main flow is:

MCP Client
→ MCP Server
→ Source Router
→ Provider Adapter
→ Resource Handler
→ Upstream Irish Open Data Source

## Layers

### 1. MCP Layer

Responsible for:

- exposing generic MCP tools
- validating tool inputs
- selecting the requested source
- calling the provider abstraction
- returning standardized responses
- returning standardized errors

The MCP layer must not contain provider-specific logic.

## 2. Source Router

The router maps a source identifier to its provider adapter.

Initial mappings:

- `data_gov_ie` → DataGovAdapter
- `smart_dublin` → SmartDublinAdapter
- `met_eireann` → MetEireannAdapter

Adding a new source should require:

1. implementing a provider adapter
2. registering the adapter

The MCP tool layer should not require changes.

## 3. Provider Interface

Every provider adapter implements the same internal contract.

Core operations:

- `search_datasets(...)`
- `get_dataset(...)`
- `get_resource(...)`

Each adapter is responsible for translating these generic operations into the upstream provider's API or catalogue structure.

## 4. Provider Adapters

Provider adapters contain source-specific behaviour.

Examples:

- DataGovAdapter
- SmartDublinAdapter
- MetEireannAdapter

Responsibilities include:

- calling upstream APIs
- translating upstream identifiers
- extracting dataset metadata
- discovering resources
- mapping upstream failures into internal errors

Provider adapters must not perform analytics or semantic transformations.

## 5. Resource Handlers

Resource format handling is separated from provider handling.

Provider adapters locate resources.

Resource handlers retrieve and convert them into MCP-friendly representations.

Initial handler types may include:

- CSV
- JSON
- XML

Example flow:

Provider Adapter
→ resource URL
→ Resource Handler
→ structured response

This prevents CSV, JSON, or XML parsing logic from being duplicated across providers.

## Response Normalization

The architecture may normalize transport-level structure across providers.

Examples include:

- source metadata
- dataset identifiers
- resource identifiers
- format
- upstream URL
- retrieval timestamp
- pagination metadata

The underlying dataset fields and values should remain unchanged wherever practical.

## Request Flow

Example dataset search:

1. MCP client calls `search_datasets`.
2. MCP layer validates the request.
3. Source router selects the requested adapter.
4. Provider adapter queries the upstream source.
5. Adapter maps the upstream response into the common response structure.
6. MCP layer returns the response.

Example resource retrieval:

1. MCP client requests a resource.
2. Source router selects the provider adapter.
3. Provider adapter resolves the resource.
4. Appropriate resource handler is selected.
5. Resource handler fetches and converts the resource if necessary.
6. MCP layer returns the result.

## Design Rules

- MCP tools remain generic.
- Provider-specific logic stays inside adapters.
- Format-specific logic stays inside resource handlers.
- One request targets one provider.
- No cross-provider joins.
- No analytics.
- No derived insights.
- No write operations.
- No provider-specific MCP tools.

## Extensibility

New Irish public-data sources should follow the same pattern:

New Source
→ New Provider Adapter
→ Register Adapter
→ Existing MCP Interface

New resource formats should follow:

New Format
→ New Resource Handler
→ Register Handler

The public MCP interface should remain stable as providers and formats are added.
