'use strict';

const core = require('@koonweee/mcp-kit');
const node = require('@koonweee/mcp-kit/node');
const auth0 = require('@koonweee/mcp-kit/auth0');
const test = require('@koonweee/mcp-kit/test');

void (async () => {
  if (typeof core.defineTool !== 'function' || typeof node.serveNode !== 'function') {
    throw new Error('CommonJS core or Node export missing');
  }
  if (typeof auth0.createAuth0Verifier !== 'function') {
    throw new Error('CommonJS Auth0 export missing');
  }
  const authority = await test.createTestJwtAuthority();
  const token = await authority.sign({ scope: 'container:read' });
  if (token.split('.').length !== 3) throw new Error('CommonJS JWT helper failed');
  console.log('container required all four CommonJS subpaths and signed a test JWT');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
