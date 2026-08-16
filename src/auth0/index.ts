export type { Auth0BearerGateOptions } from './authenticate.js';
export { createAuth0BearerGate, principalFromAuthInfo } from './authenticate.js';
export type { Auth0ProtectedResourceOptions } from './metadata.js';
export {
  createAuth0ProtectedResourceHandler,
  createAuth0ProtectedResourceMetadata,
  getAuth0ProtectedResourceMetadataUrl,
} from './metadata.js';
export type { Auth0JwksOptions, Auth0VerifierOptions } from './verifier.js';
export { createAuth0Verifier } from './verifier.js';
