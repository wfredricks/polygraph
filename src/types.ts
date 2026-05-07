/**
 * PolyGraph Core Types
 *
 * Why: These types define the labeled property graph model that PolyGraph implements.
 * Every node has labels and properties; every relationship has a type, direction, and properties.
 * This matches the Neo4j model we're replacing, minus the enterprise features we don't use.
 */

// ─── Identifiers ───────────────────────────────────────────────

export type NodeId = string;
export type RelId = string;

// ─── Core Graph Objects ────────────────────────────────────────

export interface Node {
  id: NodeId;
  labels: string[];
  properties: Record<string, any>;
}

export interface Relationship {
  id: RelId;
  type: string;
  startNode: NodeId;
  endNode: NodeId;
  properties: Record<string, any>;
}

export interface Path {
  nodes: Node[];
  relationships: Relationship[];
  length: number;
}

export interface Subgraph {
  nodes: Node[];
  relationships: Relationship[];
}

// ─── Filtering ─────────────────────────────────────────────────

export type ComparisonOp = '$eq' | '$neq' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$contains' | '$startsWith' | '$endsWith' | '$exists';

export type PropertyCondition =
  | { $eq: any }
  | { $neq: any }
  | { $gt: number }
  | { $gte: number }
  | { $lt: number }
  | { $lte: number }
  | { $in: any[] }
  | { $contains: string }
  | { $startsWith: string }
  | { $endsWith: string }
  | { $exists: boolean }
  | any; // direct value = $eq

export type PropertyFilter = Record<string, PropertyCondition>;

// ─── Traversal Options ─────────────────────────────────────────

export type Direction = 'outgoing' | 'incoming' | 'both';

export interface TraversalStep {
  direction: Direction;
  relationshipTypes?: string[];
  filter?: PropertyFilter;
}

export interface PathOptions {
  relationshipTypes?: string[];
  direction?: Direction;
  maxDepth?: number;
  costProperty?: string; // for weighted shortest path
}

export interface NeighborhoodOptions {
  relationshipTypes?: string[];
  direction?: Direction;
  nodeFilter?: PropertyFilter;
  relFilter?: PropertyFilter;
}

// ─── Index Types ───────────────────────────────────────────────

export interface IndexDefinition {
  label: string;
  propertyKey: string;
  unique?: boolean;
}

// ─── Transaction Types ─────────────────────────────────────────

export interface TransactionContext {
  id: string;
  createdAt: number;
  operations: WriteOperation[];
}

export type WriteOperation =
  | { kind: 'createNode'; node: Node }
  | { kind: 'updateNode'; id: NodeId; properties: Record<string, any> }
  | { kind: 'deleteNode'; id: NodeId }
  | { kind: 'createRelationship'; relationship: Relationship }
  | { kind: 'updateRelationship'; id: RelId; properties: Record<string, any> }
  | { kind: 'deleteRelationship'; id: RelId };

// ─── Storage Adapter Interface ─────────────────────────────────

export interface StorageAdapter {
  // Key-value operations
  get(key: string): Promise<Buffer | null>;
  put(key: string, value: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
  batch(ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }>): Promise<void>;

  // Range scan (prefix-based)
  scan(prefix: string, options?: { limit?: number; reverse?: boolean }): AsyncIterable<{ key: string; value: Buffer }>;

  // Lifecycle
  open(): Promise<void>;
  close(): Promise<void>;
}

// ─── Algorithm Types ───────────────────────────────────────────

export interface AlgorithmResult {
  [key: string]: any;
}

export interface AlgorithmDefinition {
  name: string;
  run(graph: any, options?: Record<string, any>): Promise<AlgorithmResult>;
}

// ─── Graph Engine Options ──────────────────────────────────────

export interface PolyGraphOptions {
  /** Storage adapter to use. Defaults to MemoryAdapter. */
  adapter?: StorageAdapter;
  /** Path for disk-based adapters */
  path?: string;
}
