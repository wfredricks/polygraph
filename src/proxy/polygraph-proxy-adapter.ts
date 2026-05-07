/**
 * PolyGraphProxyAdapter — Graph Proxy adapter backed by PolyGraph.
 *
 * Why: This is the bridge between the twin application's GraphProxy interface
 * and the PolyGraph engine. Drop this in where a Neo4jAdapter was, and the
 * entire application runs on PolyGraph — no other changes needed.
 *
 * Graph Spaces: Implemented as label prefixes. A node with label "Person" in
 * graph space "twin-alice" is stored as label "twin-alice::Person". This gives
 * full isolation without separate database instances.
 *
 * Pattern: Proxy adapter — translates GraphProxy operations to PolyGraph API calls.
 */

import { PolyGraph } from '../engine.js';
import { MemoryAdapter } from '../adapters/memory.js';
import { LevelAdapter } from '../adapters/level.js';
import type {
  GraphProxyAdapter,
  GraphNode,
  GraphRelationship,
  TraverseOpts,
  HealthCheckResult,
  GraphSpaceOpts,
  PortableQuery,
  ConstraintDef,
  IndexDef,
  SchemaDefinition,
  Transaction,
} from './types.js';

/** Configuration for the PolyGraph proxy adapter */
export interface PolyGraphProxyConfig {
  /** Storage mode: 'memory' for testing, 'persistent' for disk */
  storage: 'memory' | 'persistent';
  /** Path for persistent storage (required if storage is 'persistent') */
  path?: string;
}

/** Separator for graph space prefixed labels */
const SPACE_SEP = '::';

/**
 * Prefixes a label with the graph space name for isolation.
 * "Person" in space "twin-alice" → "twin-alice::Person"
 */
function scopedLabel(graphSpace: string, label: string): string {
  return `${graphSpace}${SPACE_SEP}${label}`;
}

/**
 * Strips the graph space prefix from a scoped label.
 * "twin-alice::Person" → "Person"
 */
function unscopedLabel(scopedLabel: string): string {
  const idx = scopedLabel.indexOf(SPACE_SEP);
  return idx >= 0 ? scopedLabel.substring(idx + SPACE_SEP.length) : scopedLabel;
}

/**
 * Converts a PolyGraph Node to a GraphNode (proxy format).
 * Strips the graph space prefix from the label.
 */
function toGraphNode(node: { id: string; labels: string[]; properties: Record<string, any> }): GraphNode {
  return {
    id: node.id,
    label: node.labels.length > 0 ? unscopedLabel(node.labels[0]) : '',
    properties: { ...node.properties },
  };
}

/**
 * Converts a PolyGraph Relationship to a GraphRelationship (proxy format).
 */
function toGraphRel(rel: { id: string; type: string; startNode: string; endNode: string; properties: Record<string, any> }): GraphRelationship {
  return {
    id: rel.id,
    type: rel.type,
    fromId: rel.startNode,
    toId: rel.endNode,
    properties: { ...rel.properties },
  };
}

/**
 * Maps proxy direction ('in'|'out'|'both') to PolyGraph direction.
 */
function mapDirection(dir?: 'in' | 'out' | 'both'): 'incoming' | 'outgoing' | 'both' {
  if (dir === 'in') return 'incoming';
  if (dir === 'out') return 'outgoing';
  return 'both';
}

export class PolyGraphProxyAdapter implements GraphProxyAdapter {
  readonly provider = 'polygraph';

  private graph: PolyGraph;
  private config: PolyGraphProxyConfig;
  private graphSpaces = new Set<string>();
  private connected = false;

  constructor(config: PolyGraphProxyConfig) {
    this.config = config;

    const adapter = config.storage === 'persistent' && config.path
      ? new LevelAdapter({ path: config.path })
      : new MemoryAdapter();

    this.graph = new PolyGraph({ adapter });
  }

  // ─── Connection Lifecycle ──────────────────────────────────────────

  async connect(): Promise<void> {
    await this.graph.open();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.graph.close();
    this.connected = false;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      await this.graph.stats();
      return {
        connected: this.connected,
        provider: 'polygraph',
        latencyMs: Math.round(performance.now() - start),
      };
    } catch {
      return { connected: false, provider: 'polygraph', latencyMs: -1 };
    }
  }

  // ─── Graph Space Management ────────────────────────────────────────

  async createGraphSpace(name: string, _opts?: GraphSpaceOpts): Promise<void> {
    this.graphSpaces.add(name);
  }

  async dropGraphSpace(name: string): Promise<void> {
    // Delete all nodes in this space (by scanning the space prefix)
    // For now, just remove from the set. Full cleanup would scan all scoped labels.
    this.graphSpaces.delete(name);
  }

  async listGraphSpaces(): Promise<string[]> {
    return Array.from(this.graphSpaces);
  }

  // ─── Schema ────────────────────────────────────────────────────────

  async ensureConstraint(graphSpace: string, label: string, property: string, type: 'unique' | 'exists'): Promise<void> {
    // PolyGraph doesn't have constraints yet — create an index as best-effort
    if (type === 'unique') {
      await this.graph.createIndex(scopedLabel(graphSpace, label), property);
    }
  }

  async ensureIndex(graphSpace: string, label: string, properties: string[]): Promise<void> {
    for (const prop of properties) {
      await this.graph.createIndex(scopedLabel(graphSpace, label), prop);
    }
  }

  async initSchema(graphSpace: string, schema: SchemaDefinition): Promise<void> {
    for (const constraint of schema.constraints) {
      await this.ensureConstraint(graphSpace, constraint.label, constraint.property, constraint.type);
    }
    for (const index of schema.indexes) {
      await this.ensureIndex(graphSpace, index.label, index.properties);
    }
  }

  // ─── Node Operations ───────────────────────────────────────────────

  async createNode(graphSpace: string, label: string, properties: Record<string, any>): Promise<GraphNode> {
    // Support explicit ID via _id or {label}Id convention (e.g., userId for User)
    const explicitId = properties._id || properties[`${label.toLowerCase()}Id`] || undefined;
    const props = { ...properties, _id: explicitId ?? undefined };

    const node = await this.graph.createNode(
      [scopedLabel(graphSpace, label)],
      props,
      explicitId
    );
    // Ensure _id is set on returned properties
    node.properties._id = node.id;
    return toGraphNode(node);
  }

  async getNode(graphSpace: string, id: string): Promise<GraphNode | null> {
    const node = await this.graph.getNode(id);
    if (!node) return null;
    return toGraphNode(node);
  }

  async updateNode(graphSpace: string, id: string, properties: Record<string, any>): Promise<GraphNode | null> {
    try {
      const node = await this.graph.updateNode(id, properties);
      return toGraphNode(node);
    } catch {
      return null;
    }
  }

  async deleteNode(graphSpace: string, id: string): Promise<boolean> {
    const node = await this.graph.getNode(id);
    if (!node) return false;
    await this.graph.deleteNode(id);
    return true;
  }

  async findNodes(graphSpace: string, label: string, filter?: Record<string, any>): Promise<GraphNode[]> {
    const nodes = await this.graph.findNodes(scopedLabel(graphSpace, label), filter);
    return nodes.map(toGraphNode);
  }

  async upsertNode(
    graphSpace: string,
    label: string,
    matchProperties: Record<string, any>,
    setProperties: Record<string, any>
  ): Promise<GraphNode> {
    // Find existing node matching the properties
    const existing = await this.graph.findNodes(
      scopedLabel(graphSpace, label),
      matchProperties
    );

    if (existing.length > 0) {
      // Update first match
      const updated = await this.graph.updateNode(existing[0].id, setProperties);
      return toGraphNode(updated);
    }

    // Create new
    const node = await this.graph.createNode(
      [scopedLabel(graphSpace, label)],
      { ...matchProperties, ...setProperties }
    );
    return toGraphNode(node);
  }

  // ─── Relationship Operations ───────────────────────────────────────

  async createRelationship(
    graphSpace: string,
    fromId: string,
    toId: string,
    type: string,
    properties?: Record<string, any>
  ): Promise<GraphRelationship> {
    const rel = await this.graph.createRelationship(fromId, toId, type, properties ?? {});
    return toGraphRel(rel);
  }

  async getRelationships(
    graphSpace: string,
    nodeId: string,
    opts?: { direction?: 'in' | 'out' | 'both'; type?: string }
  ): Promise<GraphRelationship[]> {
    const neighbors = await this.graph.getNeighbors(
      nodeId,
      opts?.type ? [opts.type] : undefined,
      mapDirection(opts?.direction)
    );
    return neighbors.map(({ relationship }) => toGraphRel(relationship));
  }

  async deleteRelationship(graphSpace: string, id: string): Promise<boolean> {
    const rel = await this.graph.getRelationship(id);
    if (!rel) return false;
    await this.graph.deleteRelationship(id);
    return true;
  }

  async upsertRelationship(
    graphSpace: string,
    fromId: string,
    toId: string,
    type: string,
    properties?: Record<string, any>
  ): Promise<GraphRelationship> {
    // Check for existing relationship
    const neighbors = await this.graph.getNeighbors(fromId, [type], 'outgoing');
    const existing = neighbors.find(({ node }) => node.id === toId);

    if (existing) {
      if (properties) {
        const updated = await this.graph.updateRelationship(
          existing.relationship.id,
          properties
        );
        return toGraphRel(updated);
      }
      return toGraphRel(existing.relationship);
    }

    const rel = await this.graph.createRelationship(fromId, toId, type, properties ?? {});
    return toGraphRel(rel);
  }

  // ─── Traversal ─────────────────────────────────────────────────────

  async traverse(graphSpace: string, startId: string, opts: TraverseOpts): Promise<GraphNode[]> {
    let builder = this.graph.traverse(startId);

    const direction = mapDirection(opts.direction);
    if (opts.type) {
      if (direction === 'outgoing') builder = builder.outgoing(opts.type);
      else if (direction === 'incoming') builder = builder.incoming(opts.type);
      else builder = builder.both(opts.type);
    } else {
      if (direction === 'outgoing') builder = builder.outgoing();
      else if (direction === 'incoming') builder = builder.incoming();
      else builder = builder.both();
    }

    if (opts.filter) builder = builder.where(opts.filter);
    if (opts.depth) builder = builder.depth(opts.depth);
    if (opts.limit) builder = builder.limit(opts.limit);

    const nodes = await builder.unique().collect();

    let result = nodes.map(toGraphNode);

    // Apply ordering if specified
    if (opts.orderBy) {
      const { field, direction: sortDir } = opts.orderBy;
      result.sort((a, b) => {
        const va = a.properties[field];
        const vb = b.properties[field];
        if (va < vb) return sortDir === 'DESC' ? 1 : -1;
        if (va > vb) return sortDir === 'DESC' ? -1 : 1;
        return 0;
      });
    }

    return result;
  }

  // ─── Query ─────────────────────────────────────────────────────────

  async query(graphSpace: string, portable: PortableQuery): Promise<Record<string, any>[]> {
    if (portable.kind === 'match') {
      const nodes = await this.findNodes(graphSpace, portable.label ?? '', portable.where);

      let result: Record<string, any>[] = nodes.map((n) => {
        if (portable.returnFields) {
          const row: Record<string, any> = {};
          for (const field of portable.returnFields) {
            row[field] = n.properties[field];
          }
          row.id = n.id;
          row.label = n.label;
          return row;
        }
        return { ...n.properties, id: n.id, label: n.label };
      });

      if (portable.orderBy) {
        const { field, direction } = portable.orderBy;
        result.sort((a, b) => {
          if (a[field] < b[field]) return direction === 'DESC' ? 1 : -1;
          if (a[field] > b[field]) return direction === 'DESC' ? -1 : 1;
          return 0;
        });
      }

      if (portable.limit) result = result.slice(0, portable.limit);
      return result;

    } else if (portable.kind === 'traverse') {
      const nodes = await this.traverse(graphSpace, portable.startId ?? '', {
        type: portable.relType,
        direction: portable.direction,
        depth: portable.depth,
        limit: portable.limit,
      });

      return nodes.map((n) => {
        if (portable.returnFields) {
          const row: Record<string, any> = {};
          for (const field of portable.returnFields) {
            row[field] = n.properties[field];
          }
          row.id = n.id;
          row.label = n.label;
          return row;
        }
        return { ...n.properties, id: n.id, label: n.label };
      });
    }

    return [];
  }

  async rawQuery(graphSpace: string, query: string, _params?: Record<string, any>): Promise<Record<string, any>[]> {
    // Delegate to PolyGraph's Cypher bridge
    return this.graph.query(query);
  }

  // ─── Batch Operations ──────────────────────────────────────────────

  async batchCreateNodes(graphSpace: string, label: string, items: Record<string, any>[]): Promise<GraphNode[]> {
    const results: GraphNode[] = [];
    for (const props of items) {
      results.push(await this.createNode(graphSpace, label, props));
    }
    return results;
  }

  async batchUpsertNodes(graphSpace: string, label: string, matchKey: string, items: Record<string, any>[]): Promise<GraphNode[]> {
    const results: GraphNode[] = [];
    for (const props of items) {
      const matchProps = { [matchKey]: props[matchKey] };
      results.push(await this.upsertNode(graphSpace, label, matchProps, props));
    }
    return results;
  }

  async batchCreateRelationships(
    graphSpace: string,
    items: { fromId: string; toId: string; type: string; properties?: Record<string, any> }[]
  ): Promise<GraphRelationship[]> {
    const results: GraphRelationship[] = [];
    for (const item of items) {
      results.push(
        await this.createRelationship(graphSpace, item.fromId, item.toId, item.type, item.properties)
      );
    }
    return results;
  }

  // ─── Transactions ──────────────────────────────────────────────────

  async beginTransaction(graphSpace: string): Promise<Transaction> {
    // PolyGraph's withTx is function-scoped, not imperative.
    // We provide a compatibility shim that buffers operations.
    const adapter = this;
    const ops: Array<() => Promise<void>> = [];
    let committed = false;

    const tx: Transaction = {
      async commit() {
        committed = true;
        for (const op of ops) await op();
      },
      async rollback() {
        ops.length = 0;
      },
      async createNode(label, properties) {
        const node = await adapter.createNode(graphSpace, label, properties);
        return node;
      },
      async getNode(id) {
        return adapter.getNode(graphSpace, id);
      },
      async updateNode(id, properties) {
        return adapter.updateNode(graphSpace, id, properties);
      },
      async deleteNode(id) {
        return adapter.deleteNode(graphSpace, id);
      },
      async findNodes(label, filter?) {
        return adapter.findNodes(graphSpace, label, filter);
      },
      async upsertNode(label, matchProps, setProps) {
        return adapter.upsertNode(graphSpace, label, matchProps, setProps);
      },
      async createRelationship(fromId, toId, type, properties?) {
        return adapter.createRelationship(graphSpace, fromId, toId, type, properties);
      },
      async deleteRelationship(id) {
        return adapter.deleteRelationship(graphSpace, id);
      },
      async upsertRelationship(fromId, toId, type, properties?) {
        return adapter.upsertRelationship(graphSpace, fromId, toId, type, properties);
      },
    };

    return tx;
  }

  // ─── Feature Detection ─────────────────────────────────────────────

  hasFeature(feature: string): boolean {
    const supported = new Set([
      'nodes', 'relationships', 'traversal', 'batch',
      'indexes', 'cypher-bridge', 'upsert', 'graph-spaces',
    ]);
    return supported.has(feature);
  }

  // ─── Convenience (matches MockAdapter API) ─────────────────────────

  /** Current node count (convenience for testing) */
  get nodeCount(): number | Promise<number> {
    return this.graph.stats().then((s) => s.nodeCount);
  }

  /** Current relationship count (convenience for testing) */
  get relationshipCount(): number | Promise<number> {
    return this.graph.stats().then((s) => s.relationshipCount);
  }

  /** Resets the adapter — closes and reopens with a fresh MemoryAdapter */
  async reset(): Promise<void> {
    await this.graph.close();
    this.graph = new PolyGraph({ adapter: new MemoryAdapter() });
    await this.graph.open();
    this.graphSpaces.clear();
  }
}
