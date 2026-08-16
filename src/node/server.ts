import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createMcpHandler, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server';
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from '@modelcontextprotocol/node';
import type { McpPrincipal, McpRequestContext, McpRequestInfo } from '../core/context.js';
import { createRequestContext } from '../core/context.js';
import { createMcpServer, type McpServerDefinition } from '../core/definition.js';
import { safeConsoleLogger, type McpLogger } from '../core/logging.js';

/** Inputs available while constructing request-local service dependencies and logging. */
export interface NodeRequestFactoryContext {
  readonly requestId: string;
  readonly principal?: McpPrincipal;
  readonly request: McpRequestInfo;
}

/** An Auth0-compatible, Web-standard authentication gate. */
export type NodeAuthenticator = (request: Request) => Promise<AuthInfo | Response>;

/** Configuration for the stateless Node adapter. */
export interface CreateNodeMcpHandlerOptions<TDependencies> {
  readonly dependencies: (
    context: NodeRequestFactoryContext,
  ) => TDependencies | Promise<TDependencies>;
  readonly logger?: McpLogger | ((context: NodeRequestFactoryContext) => McpLogger);
  readonly authenticate?: NodeAuthenticator;
  readonly principalFromAuthInfo?: (authInfo: AuthInfo) => McpPrincipal;
  readonly discovery?: (request: Request) => Response | undefined;
  readonly mcpPath?: string;
  readonly healthPath?: string;
  readonly allowedHostnames?: readonly string[];
  readonly allowedOriginHostnames?: readonly string[];
  readonly maxBodyBytes?: number;
  readonly requestId?: () => string;
}

/** Composable Node handler with explicit lifecycle cleanup. */
export interface NodeMcpHandler {
  readonly handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  readonly close: () => Promise<void>;
  readonly sdkHandler: McpHttpHandler;
}

/** Result returned by `serveNode`. */
export interface RunningNodeMcpServer {
  readonly server: Server;
  readonly url: URL;
  readonly close: () => Promise<void>;
}

function defaultPrincipal(authInfo: AuthInfo): McpPrincipal {
  const subject = authInfo.extra?.['subject'];
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new TypeError('Authenticated requests require a validated subject');
  }
  return {
    subject,
    clientId: authInfo.clientId,
    scopes: new Set(authInfo.scopes),
    ...(authInfo.expiresAt !== undefined ? { expiresAt: authInfo.expiresAt } : {}),
  };
}

function requestInfo(
  request: Request | undefined,
  protocolEra?: 'legacy' | 'modern',
): McpRequestInfo {
  return {
    ...(request ? { method: request.method, url: new URL(request.url) } : {}),
    ...(protocolEra ? { protocolEra } : {}),
  };
}

function loggerFor(
  logger: CreateNodeMcpHandlerOptions<unknown>['logger'],
  context: NodeRequestFactoryContext,
): McpLogger {
  if (!logger) return safeConsoleLogger;
  return typeof logger === 'function' ? logger(context) : logger;
}

function contentTypeIsJson(value: string | undefined): boolean {
  if (!value) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

async function readBoundedJson(
  request: IncomingMessage,
  maxBytes: number,
): Promise<{ body?: unknown; tooLarge: boolean; invalid: boolean }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      request.resume();
      return { tooLarge: true, invalid: false };
    }
    chunks.push(chunk);
  }
  if (bytes === 0) return { tooLarge: false, invalid: false };
  try {
    return {
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      tooLarge: false,
      invalid: false,
    };
  } catch {
    return { tooLarge: false, invalid: true };
  }
}

function sendJson(response: ServerResponse, status: number, code: number, message: string): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }),
  );
}

/**
 * Creates a stateless `/mcp` Node handler backed by the official SDK v2 Web handler.
 * Host/origin guards are applied before routing and forwarded headers are never trusted implicitly.
 */
export function createNodeMcpHandler<TDependencies>(
  definition: McpServerDefinition<TDependencies>,
  options: CreateNodeMcpHandlerOptions<TDependencies>,
): NodeMcpHandler {
  const mcpPath = options.mcpPath ?? '/mcp';
  const healthPath = options.healthPath ?? '/healthz';
  if (!mcpPath.startsWith('/') || !healthPath.startsWith('/')) {
    throw new TypeError('mcpPath and healthPath must be absolute pathnames');
  }
  if (mcpPath === healthPath) throw new TypeError('mcpPath and healthPath must be distinct');
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new RangeError('maxBodyBytes must be a positive safe integer');
  }

  const toPrincipal = options.principalFromAuthInfo ?? defaultPrincipal;
  const id = options.requestId ?? randomUUID;
  const sdkHandler = createMcpHandler(async (sdkContext) => {
    const principal = sdkContext.authInfo ? toPrincipal(sdkContext.authInfo) : undefined;
    const request = requestInfo(sdkContext.requestInfo, sdkContext.era);
    const requestId = id();
    const factoryContext: NodeRequestFactoryContext = {
      requestId,
      ...(principal ? { principal } : {}),
      request,
    };
    const context: McpRequestContext<TDependencies> = createRequestContext({
      requestId,
      ...(principal ? { principal } : {}),
      request,
      logger: loggerFor(options.logger, factoryContext),
      dependencies: await options.dependencies(factoryContext),
    });
    return createMcpServer(definition, context);
  });

  const webRouter = {
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === healthPath) {
        return Response.json({ status: 'ok' });
      }
      const discovery = options.discovery?.(request);
      if (discovery) return discovery;
      if (path !== mcpPath) return Response.json({ error: 'Not found' }, { status: 404 });

      let authInfo: AuthInfo | undefined;
      if (options.authenticate) {
        const authenticated = await options.authenticate(request);
        if (authenticated instanceof Response) return authenticated;
        authInfo = authenticated;
      }
      return sdkHandler.fetch(request, authInfo ? { authInfo } : undefined);
    },
  };
  const nodeHandler = toNodeHandler(webRouter);
  const validateHost = options.allowedHostnames
    ? hostHeaderValidation([...options.allowedHostnames])
    : localhostHostValidation();
  const validateOrigin = options.allowedOriginHostnames
    ? originValidation([...options.allowedOriginHostnames])
    : localhostOriginValidation();

  return {
    sdkHandler,
    async handle(request, response) {
      if (!validateHost(request, response) || !validateOrigin(request, response)) return;
      const method = (request.method ?? 'GET').toUpperCase();
      let parsedBody: unknown;
      if (method === 'POST') {
        const declaredLength = Number(request.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
          request.resume();
          sendJson(response, 413, -32_000, 'Request body too large');
          return;
        }
        if (!contentTypeIsJson(request.headers['content-type'])) {
          request.resume();
          sendJson(response, 415, -32_000, 'Content-Type must be application/json');
          return;
        }
        const body = await readBoundedJson(request, maxBodyBytes);
        if (body.tooLarge) {
          sendJson(response, 413, -32_000, 'Request body too large');
          return;
        }
        if (body.invalid) {
          sendJson(response, 400, -32_700, 'Invalid JSON');
          return;
        }
        parsedBody = body.body;
      }
      await nodeHandler(request as unknown as NodeIncomingMessageLike, response, parsedBody);
    },
    close: () => sdkHandler.close(),
  };
}

/** Starts a loopback-by-default Node server and returns a graceful close operation. */
export async function serveNode<TDependencies>(
  definition: McpServerDefinition<TDependencies>,
  options: CreateNodeMcpHandlerOptions<TDependencies> & {
    readonly hostname?: string;
    readonly port?: number;
  },
): Promise<RunningNodeMcpServer> {
  const handler = createNodeMcpHandler(definition, options);
  const hostname = options.hostname ?? '127.0.0.1';
  const port = options.port ?? 0;
  let shutdownRequested = false;
  const server = createServer((request, response) => {
    void handler
      .handle(request, response)
      .catch(() => {
        if (!response.headersSent) sendJson(response, 500, -32_603, 'Internal server error');
        else response.end();
      })
      .finally(() => {
        if (shutdownRequested) server.closeIdleConnections();
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Node server has no TCP address');

  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= new Promise<void>((resolve, reject) => {
      shutdownRequested = true;
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeIdleConnections();
    }).then(() => handler.close());
    return closing;
  };

  return {
    server,
    url: new URL(`http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${address.port}`),
    close,
  };
}
