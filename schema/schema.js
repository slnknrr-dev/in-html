// schema/schema.js - the public surface of the schema library in one import.
// Re-exports only; export * fails loudly at link time if two modules ever export the same name, which keeps the
// flat namespace honest. Consumers that care about bundle size import the individual modules instead.
export * from './text.js';
export * from './rules.js';
export * from './fields.js';
export * from './inherit.js';
export * from './tags.js';
