'use strict';

let loaded;

/** Loads jose through native import so CommonJS hosts can use its ESM-only v6 release. */
function loadJose() {
  loaded ??= import('jose');
  return loaded;
}

module.exports = { loadJose };
