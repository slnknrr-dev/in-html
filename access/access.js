// access/access.js - the public surface of the access library in one import.
//
// Layering of the library, from coarse to fine: config (what the instance offers) -> modules (which features are on)
// -> roles (what a member may do, per section) -> policy (which records: own or all) -> scope (what this session may
// use of that) -> tokens (what the UI shows). Each layer only narrows the previous one; none can widen it.
export * from './roles.js';
export * from './policy.js';
export * from './scope.js';
export * from './tokens.js';
export * from './modules.js';
export * from './config.js';
