# Data Sources

## Overview

Ireland Open Data MCP initially supports three providers:

- `data_gov_ie`
- `smart_dublin`
- `met_eireann`

Each provider is implemented through its own adapter and configuration file.

## Provider Configuration

Each provider has an independent YAML configuration file:

- `config/data_gov_ie.yml`
- `config/smart_dublin.yml`
- `config/met_eireann.yml`

Provider URLs and operational settings must not be hardcoded in application code.

## Configuration Responsibilities

Provider configuration may define:

- provider name
- base URL
- API endpoint paths
- HTTP timeout
- pagination defaults
- maximum result limits
- supported resource formats
- other connection-level settings

Response parsing and provider-specific transformation logic must remain in adapter code.

## Capabilities

Each provider configuration must contain a dedicated `capabilities` section.

Example structure:

    provider: data_gov_ie

    capabilities:
      search_datasets: true
      get_dataset: true
      get_resource: true

    formats:
      - csv
      - json
      - xml

Capabilities determine which generic MCP operations can be executed against the provider.

Unsupported operations must fail with a standardized error.

## Supported Formats

Each provider explicitly declares the resource formats it supports.

Examples:

- CSV
- JSON
- XML

The server must not assume that every provider supports every format.

Unsupported formats should return a standardized `UNSUPPORTED_FORMAT` error.

## Provider Adapters

Each provider has its own adapter:

- `DataGovAdapter`
- `SmartDublinAdapter`
- `MetEireannAdapter`

Adapters are responsible for:

- reading provider configuration
- communicating with the upstream service
- mapping generic operations to provider APIs
- parsing provider-specific responses
- discovering available resources
- returning data through the common internal model
- translating upstream errors into standard errors

## DataGov.ie

Source identifier:

`data_gov_ie`

The adapter provides access to datasets exposed by Ireland's national open-data portal.

It should support the generic MCP operations enabled by its configuration.

Provider-specific catalogue behaviour must remain inside `DataGovAdapter`.

## Smart Dublin

Source identifier:

`smart_dublin`

The adapter provides access to public datasets exposed through Smart Dublin.

Provider-specific catalogue behaviour must remain inside `SmartDublinAdapter`.

## Met Éireann

Source identifier:

`met_eireann`

The adapter provides access to publicly available Met Éireann data.

Unlike catalogue-oriented providers, its underlying API structure may differ significantly.

These differences must remain hidden inside `MetEireannAdapter`.

The MCP layer must continue exposing the same generic interface.

## Resource Retrieval

When a provider returns a resource:

1. The provider adapter resolves the resource.
2. The resource format is identified.
3. The corresponding shared resource handler is selected.
4. The resource is fetched.
5. Minimal format conversion is performed when required.
6. The result is returned with provenance metadata.

## Configuration-Driven Behaviour

Configuration should control behaviour that can reasonably change without modifying code.

Examples:

- API locations
- enabled capabilities
- supported formats
- limits
- timeout values
- pagination defaults

Complex parsing logic must not be implemented in YAML.

## Adding Providers

Adding another Irish public-data provider should require:

1. creating a provider configuration file
2. implementing the common provider interface
3. registering the adapter

Existing MCP tools must not require modification.

## Design Constraint

Providers may expose completely different upstream APIs.

The adapter layer exists specifically to absorb these differences.

Neither MCP clients nor MCP tools should need to understand how an individual upstream provider works.
