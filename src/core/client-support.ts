import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  type ClientCapabilities,
  type ServerContext,
} from '@modelcontextprotocol/server';

export type McpClientProtocolEra = 'modern' | 'legacy' | 'unknown';

/** Narrow capability view safe for service tools to branch on. */
export interface McpClientSupport {
  readonly protocolEra: McpClientProtocolEra;
  readonly inputRequired: {
    /** Form elicitation can be carried by modern input-required or the SDK's legacy shim. */
    readonly formElicitation: boolean;
    /** URL elicitation can be carried by modern input-required or the SDK's legacy shim. */
    readonly urlElicitation: boolean;
  };
}

interface ClientSupportInputs {
  readonly sdkContext?: ServerContext;
  readonly adapterEra?: 'modern' | 'legacy';
  readonly legacyCapabilities?: ClientCapabilities;
  readonly negotiatedProtocolVersion?: string;
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function envelopeOf(
  context: ServerContext | undefined,
): Readonly<Record<string, unknown>> | undefined {
  // SDK 2.0.0 exposes this public runtime envelope and its key constants, but currently declares
  // RequestMetaEnvelope as `{}`. Keep the unavoidable narrowing isolated inside the kit.
  return objectRecord(context?.mcpReq.envelope);
}

function capabilitiesOf(
  envelope: Readonly<Record<string, unknown>> | undefined,
): ClientCapabilities | undefined {
  return objectRecord(envelope?.[CLIENT_CAPABILITIES_META_KEY]);
}

function protocolEraOf(
  inputs: ClientSupportInputs,
  envelope: Readonly<Record<string, unknown>> | undefined,
): McpClientProtocolEra {
  if (typeof envelope?.[PROTOCOL_VERSION_META_KEY] === 'string') return 'modern';
  if (inputs.adapterEra) return inputs.adapterEra;
  // Modern requests carry the versioned envelope. A negotiated connection without one is legacy.
  if (inputs.negotiatedProtocolVersion) return 'legacy';
  return 'unknown';
}

function elicitationSupport(capabilities: ClientCapabilities | undefined) {
  const elicitation = objectRecord(capabilities?.elicitation);
  if (!elicitation) return { formElicitation: false, urlElicitation: false } as const;
  const form = elicitation['form'] !== undefined;
  const url = elicitation['url'] !== undefined;
  return {
    // The official SDK treats a pre-mode `elicitation: {}` declaration as form support.
    formElicitation: form || (!form && !url),
    urlElicitation: url,
  } as const;
}

/** @internal Resolves only the capability booleans tools need, never client identity or claims. */
export function resolveMcpClientSupport(inputs: ClientSupportInputs): McpClientSupport {
  const envelope = envelopeOf(inputs.sdkContext);
  const protocolEra = protocolEraOf(inputs, envelope);
  const capabilities =
    protocolEra === 'modern' ? capabilitiesOf(envelope) : inputs.legacyCapabilities;
  return Object.freeze({
    protocolEra,
    inputRequired: Object.freeze(elicitationSupport(capabilities)),
  });
}
