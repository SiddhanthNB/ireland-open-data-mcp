import { parse } from "yaml";
import { z } from "zod";

import {
  PROVIDER_OPERATIONS,
  SOURCES,
  type ProviderCapabilities,
  type ProviderConfig,
  type ResourceFormat,
  type Source,
} from "../models";

const endpointPathSchema = z
  .string()
  .min(1)
  .startsWith("/")
  .refine((value) => !value.startsWith("//"), {
    message: "endpoint paths must start with exactly one slash",
  })
  .refine((value) => !value.includes("?"), {
    message: "endpoint paths must not contain query parameters",
  });

const endpointsSchema = z
  .object({
    package_search: endpointPathSchema,
    package_show: endpointPathSchema,
    datastore_search: endpointPathSchema,
  })
  .strict();

const paginationSchema = z
  .object({
    default_limit: z.number().int().positive(),
    max_limit: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.default_limit <= value.max_limit, {
    message: "default_limit must not exceed max_limit",
    path: ["default_limit"],
  });

const capabilitiesSchema = z
  .object(
    Object.fromEntries(
      PROVIDER_OPERATIONS.map((operation) => [operation, z.boolean()]),
    ) as Record<(typeof PROVIDER_OPERATIONS)[number], z.ZodBoolean>,
  )
  .strict();

const formatsSchema = z
  .array(z.enum(["csv", "json", "xml"]))
  .min(1)
  .refine((formats) => new Set(formats).size === formats.length, {
    message: "formats must not contain duplicates",
  });

const scopeSchema = z
  .object({
    organization_name: z.string().min(1),
    organization_id: z.string().min(1),
  })
  .strict();

const providerConfigSchema = z
  .object({
    provider: z.enum(SOURCES),
    base_url: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:", {
        message: "base_url must use HTTPS",
      })
      .refine((value) => !value.endsWith("/"), {
        message: "base_url must not end with a slash",
      }),
    endpoints: endpointsSchema,
    http_timeout_ms: z.number().int().positive(),
    pagination: paginationSchema,
    capabilities: capabilitiesSchema,
    formats: formatsSchema,
    scope: scopeSchema.optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.provider === "met_eireann" && config.scope === undefined) {
      context.addIssue({
        code: "custom",
        message: "met_eireann requires an organization scope",
        path: ["scope"],
      });
    }

    if (config.provider !== "met_eireann" && config.scope !== undefined) {
      context.addIssue({
        code: "custom",
        message: "organization scope is only supported for met_eireann",
        path: ["scope"],
      });
    }
  });

export interface CkanEndpoints {
  readonly [endpoint: string]: string;
  readonly package_search: string;
  readonly package_show: string;
  readonly datastore_search: string;
}

export interface ProviderScope {
  readonly organization_name: string;
  readonly organization_id: string;
}

export interface LoadedProviderConfig extends ProviderConfig {
  readonly provider: Source;
  readonly base_url: string;
  readonly endpoints: CkanEndpoints;
  readonly http_timeout_ms: number;
  readonly pagination: Readonly<{
    default_limit: number;
    max_limit: number;
  }>;
  readonly capabilities: Readonly<ProviderCapabilities>;
  readonly formats: readonly ResourceFormat[];
  readonly scope?: ProviderScope;
}

export interface ProviderConfigDocument {
  readonly expectedProvider: Source;
  readonly contents: string;
}

export class ProviderConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderConfigError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }

  return value;
}

export function parseProviderConfig(
  contents: string,
  expectedProvider: Source,
): LoadedProviderConfig {
  let document: unknown;

  try {
    document = parse(contents);
  } catch (cause) {
    throw new ProviderConfigError(
      `Invalid YAML for provider ${expectedProvider}`,
      { cause },
    );
  }

  const result = providerConfigSchema.safeParse(document);
  if (!result.success) {
    throw new ProviderConfigError(
      `Invalid configuration for provider ${expectedProvider}: ${z.prettifyError(result.error)}`,
      { cause: result.error },
    );
  }

  if (result.data.provider !== expectedProvider) {
    throw new ProviderConfigError(
      `Provider mismatch: expected ${expectedProvider}, received ${result.data.provider}`,
    );
  }

  return deepFreeze(result.data);
}

export function loadProviderConfigs(
  documents: readonly ProviderConfigDocument[],
): Readonly<Record<Source, LoadedProviderConfig>> {
  const configs = new Map<Source, LoadedProviderConfig>();

  for (const document of documents) {
    if (configs.has(document.expectedProvider)) {
      throw new ProviderConfigError(
        `Duplicate configuration for provider ${document.expectedProvider}`,
      );
    }

    configs.set(
      document.expectedProvider,
      parseProviderConfig(document.contents, document.expectedProvider),
    );
  }

  const missingProviders = SOURCES.filter((source) => !configs.has(source));
  if (missingProviders.length > 0) {
    throw new ProviderConfigError(
      `Missing configuration for provider(s): ${missingProviders.join(", ")}`,
    );
  }

  return deepFreeze(
    Object.fromEntries(configs) as Record<Source, LoadedProviderConfig>,
  );
}
