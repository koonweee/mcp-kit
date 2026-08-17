'use strict';

let loaded;

/**
 * Loads the packaged CommonJS jose runtime when built, with native import only as a source-tree
 * fallback for development commands that have not built the package yet.
 */
function loadJose() {
  if (!loaded) {
    try {
      loaded = Promise.resolve(require('./jose-runtime.cjs'));
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error;
      loaded = import('jose');
    }
  }
  return loaded;
}

module.exports = { loadJose };
