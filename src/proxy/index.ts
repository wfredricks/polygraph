/**
 * Graph Proxy — Application-level adapter pattern for PolyGraph.
 *
 * Why: The Proxy pattern gives applications a provider-agnostic interface
 * for graph operations. Swap PolyGraphProxyAdapter for a Neo4j or TigerGraph
 * adapter and the application code doesn't change.
 *
 * This is the recommended way to use PolyGraph in applications.
 */

export * from './types.js';
export { PolyGraphProxyAdapter } from './polygraph-proxy-adapter.js';
export type { PolyGraphProxyConfig } from './polygraph-proxy-adapter.js';
