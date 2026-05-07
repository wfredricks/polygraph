/**
 * TwinGraph Types — Graph Proxy interfaces for digital twin applications.
 *
 * Why: These interfaces define the provider-agnostic contract between the twin
 * application and any graph backend. The pattern is a Proxy — callers don't know
 * or care whether PolyGraph, Neo4j, or TigerGraph is underneath.
 *
 * Naming: "GraphProxy" replaces the legacy "LiteGraph" convention.
 * The pattern is a proxy, so we name it what it is.
 *
 * Compatibility: Interface shapes match the UDT's LiteGraphAdapter so that
 * swapping `new Neo4jAdapter()` for `new PolyGraphProxyAdapter()` is a one-line change.
 */

// ─── Core Data Types ───────────────────────────────────────────────

/** A node in the graph */
export interface GraphNode {
  id: string;
  label: string;
  properties: Record<string, any>;
}

/** A directed relationship in the graph */
export interface GraphRelationship {
  id: string;
  type: string;
  fromId: string;
  toId: string;
  properties: Record<string, any>;
}

/** Traversal options */
export interface TraverseOpts {
  type?: string;
  direction?: 'in' | 'out' | 'both';
  depth?: number;
  filter?: Record<string, any>;
  orderBy?: { field: string; direction?: 'ASC' | 'DESC' };
  limit?: number;
  returnFields?: string[];
}

/** Health check result */
export interface HealthCheckResult {
  connected: boolean;
  provider: string;
  latencyMs: number;
}

/** Graph space options */
export interface GraphSpaceOpts {
  type?: 'twin' | 'org' | 'shared';
}

/** Sort direction for queries */
export type SortDirection = 'ASC' | 'DESC';

/** Portable query that works across providers */
export interface PortableQuery {
  kind: 'match' | 'traverse';
  label?: string;
  where?: Record<string, any>;
  orderBy?: { field: string; direction: SortDirection };
  limit?: number;
  returnFields?: string[];
  startId?: string;
  startLabel?: string;
  relType?: string;
  endLabel?: string;
  depth?: number;
  direction?: 'in' | 'out' | 'both';
}

/** Schema constraint */
export interface ConstraintDef {
  label: string;
  property: string;
  type: 'unique' | 'exists';
}

/** Schema index */
export interface IndexDef {
  label: string;
  properties: string[];
}

/** Complete schema definition */
export interface SchemaDefinition {
  version: string;
  constraints: ConstraintDef[];
  indexes: IndexDef[];
}

/** Transaction scope */
export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  createNode(label: string, properties: Record<string, any>): Promise<GraphNode>;
  getNode(id: string): Promise<GraphNode | null>;
  updateNode(id: string, properties: Record<string, any>): Promise<GraphNode | null>;
  deleteNode(id: string): Promise<boolean>;
  findNodes(label: string, filter?: Record<string, any>): Promise<GraphNode[]>;
  upsertNode(label: string, matchProperties: Record<string, any>, setProperties: Record<string, any>): Promise<GraphNode>;
  createRelationship(fromId: string, toId: string, type: string, properties?: Record<string, any>): Promise<GraphRelationship>;
  deleteRelationship(id: string): Promise<boolean>;
  upsertRelationship(fromId: string, toId: string, type: string, properties?: Record<string, any>): Promise<GraphRelationship>;
}

// ─── Adapter Interface ─────────────────────────────────────────────

/**
 * GraphProxyAdapter — the interface every graph backend must implement.
 *
 * Why: This is the seam. Swap the adapter, swap the backend.
 * The twin application never touches provider-specific code.
 *
 * Pattern: Proxy — delegates operations to the underlying graph engine.
 */
export interface GraphProxyAdapter {
  readonly provider: string;

  // Connection lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;

  // Graph space management
  createGraphSpace(name: string, opts?: GraphSpaceOpts): Promise<void>;
  dropGraphSpace(name: string): Promise<void>;
  listGraphSpaces(): Promise<string[]>;

  // Schema
  ensureConstraint(graphSpace: string, label: string, property: string, type: 'unique' | 'exists'): Promise<void>;
  ensureIndex(graphSpace: string, label: string, properties: string[]): Promise<void>;
  initSchema(graphSpace: string, schema: SchemaDefinition): Promise<void>;

  // Node operations
  createNode(graphSpace: string, label: string, properties: Record<string, any>): Promise<GraphNode>;
  getNode(graphSpace: string, id: string): Promise<GraphNode | null>;
  updateNode(graphSpace: string, id: string, properties: Record<string, any>): Promise<GraphNode | null>;
  deleteNode(graphSpace: string, id: string): Promise<boolean>;
  findNodes(graphSpace: string, label: string, filter?: Record<string, any>): Promise<GraphNode[]>;
  upsertNode(graphSpace: string, label: string, matchProperties: Record<string, any>, setProperties: Record<string, any>): Promise<GraphNode>;

  // Relationship operations
  createRelationship(graphSpace: string, fromId: string, toId: string, type: string, properties?: Record<string, any>): Promise<GraphRelationship>;
  getRelationships(graphSpace: string, nodeId: string, opts?: { direction?: 'in' | 'out' | 'both'; type?: string }): Promise<GraphRelationship[]>;
  deleteRelationship(graphSpace: string, id: string): Promise<boolean>;
  upsertRelationship(graphSpace: string, fromId: string, toId: string, type: string, properties?: Record<string, any>): Promise<GraphRelationship>;

  // Traversal
  traverse(graphSpace: string, startId: string, opts: TraverseOpts): Promise<GraphNode[]>;

  // Query
  query(graphSpace: string, portable: PortableQuery): Promise<Record<string, any>[]>;
  rawQuery(graphSpace: string, query: string, params?: Record<string, any>): Promise<Record<string, any>[]>;

  // Batch operations
  batchCreateNodes(graphSpace: string, label: string, items: Record<string, any>[]): Promise<GraphNode[]>;
  batchUpsertNodes(graphSpace: string, label: string, matchKey: string, items: Record<string, any>[]): Promise<GraphNode[]>;
  batchCreateRelationships(graphSpace: string, items: { fromId: string; toId: string; type: string; properties?: Record<string, any> }[]): Promise<GraphRelationship[]>;

  // Transactions
  beginTransaction(graphSpace: string): Promise<Transaction>;

  // Feature detection
  hasFeature(feature: string): boolean;
}
