/**
 * PolyGraph — Purpose-built embeddable graph engine
 *
 * Why: Government-ownable alternative to Neo4j for labeled property graph workloads.
 * No FedRAMP gaps, no licensing constraints, no enterprise bloat.
 * Embeds like SQLite — import as a library, no separate server process.
 */

export * from './types.js';
export { PolyGraph } from './engine.js';
export { MemoryAdapter } from './adapters/memory.js';
export { LevelAdapter } from './adapters/level.js';
export type { LevelAdapterOptions } from './adapters/level.js';
export { TraversalBuilder } from './traversal.js';

// Graph Proxy — application-level adapter pattern
export { PolyGraphProxyAdapter } from './proxy/polygraph-proxy-adapter.js';
export type { PolyGraphProxyConfig } from './proxy/polygraph-proxy-adapter.js';
export type {
  GraphProxyAdapter,
  GraphNode,
  GraphRelationship,
  TraverseOpts,
  PortableQuery,
  SchemaDefinition,
  HealthCheckResult,
  Transaction as GraphTransaction,
} from './proxy/types.js';
