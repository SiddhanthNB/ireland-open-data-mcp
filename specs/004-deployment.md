# Deployment

## Overview

Ireland Open Data MCP is deployed as a remote MCP server on:

**Cloudflare Workers using Python**

The service is accessed over HTTP.

Local `stdio` transport is not part of the core deployment.

## Runtime

Primary runtime:

- Cloudflare Workers
- Python

The implementation should remain compatible with Cloudflare Worker runtime constraints.

Dependencies should be kept minimal.

Packages that require unsupported native system libraries should be avoided.

## Deployment Flow

Expected flow:

1. Develop locally.
2. Run local Worker environment.
3. Validate MCP tools.
4. Deploy using Cloudflare tooling.
5. Test the deployed remote MCP endpoint.

## Configuration

Provider configuration files are stored under:

- `config/data_gov_ie.yml`
- `config/smart_dublin.yml`
- `config/met_eireann.yml`

Configuration should contain provider-specific operational settings and capabilities.

Sensitive values must not be committed to the repository.

## Secrets

Secrets must be stored using Cloudflare-supported secret management.

Examples include:

- OAuth client secrets
- future upstream API keys
- other credentials

Secrets must never be stored in YAML configuration files or source code.

## Public MCP Endpoint

The deployed service exposes a remote MCP endpoint over HTTPS.

The MCP client communicates directly with this endpoint.

Example conceptual flow:

MCP Client  
→ HTTPS  
→ Cloudflare Worker  
→ Ireland Open Data MCP  
→ Public Data Provider

## Authentication

Authentication is not required for the initial core service.

GitHub OAuth may be added later through Cloudflare as an access-control layer.

OAuth protects access to the MCP server itself.

It does not authenticate against the public-data providers.

## GitHub OAuth

When enabled, the flow should be:

MCP Client  
→ OAuth authorization  
→ GitHub identity  
→ Cloudflare MCP server  
→ Public data provider

OAuth must remain optional and separate from core provider functionality.

## Availability

The service should fail gracefully when an upstream provider is unavailable.

Upstream failures must not crash the Worker.

Failures should return standardized MCP errors such as:

- `UPSTREAM_ERROR`
- `UPSTREAM_TIMEOUT`
- `RATE_LIMITED`

## Timeouts

Outbound requests must use explicit timeouts.

Timeout values may be configured per provider.

## Logging

The application should log operational information needed for debugging.

Logs should include:

- provider
- operation
- success or failure
- upstream status where relevant
- execution duration where practical

Logs must not expose secrets or authentication tokens.

## Caching

Caching is not required for the initial deployment.

A later phase may introduce Cloudflare caching for stable metadata.

Potential cache targets include:

- dataset metadata
- catalogue responses
- resource descriptions

Live data should not be cached without an explicit freshness policy.

## Deployment Principles

- single remote HTTP service
- Cloudflare Workers as primary runtime
- Python implementation
- configuration-driven providers
- secrets outside source control
- minimal dependencies
- no local server dependency
- no database dependency required for core functionality
- authentication remains optional
