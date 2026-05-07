/**
 * PolyGraph Engine — The 10% I/O shell.
 *
 * Why: This class is the thin coordination layer between the storage adapter
 * and the pure functions in src/pure/. It handles reads, writes, and async
 * iteration — the irreducibly side-effectful operations. All logic that CAN
 * be pure IS pure and lives in the pure/ directory.
 *
 * Architecture: 90% pure functions (src/pure/) / 10% I/O shell (this file).
 */

import { randomUUID } from 'crypto';
import type {
  Node,
  NodeId,
  Relationship,
  RelId,
  PropertyFilter,
  StorageAdapter,
  PolyGraphOptions,
  Path,
  PathOptions,
  Subgraph,
  NeighborhoodOptions,
} from './types.js';
import { MemoryAdapter } from './adapters/memory.js';
import { TraversalBuilder } from './traversal.js';
import {
  // Filters
  matchesFilter,
  extractEqualityValue,
  // Keys
  nodeKey,
  nodeLabelKey,
  nodeOutKey,
  nodeInKey,
  nodeOutPrefix,
  nodeOutTypePrefix,
  nodeInPrefix,
  nodeInTypePrefix,
  relKey,
  relPrefix,
  labelIndexKey,
  labelIndexPrefix,
  propIndexKey,
  propIndexValuePrefix,
  propIndexPrefix,
  COUNTER_NODE_COUNT,
  COUNTER_REL_COUNT,
  lastSegment,
  stripPrefix,
  // Serialization
  serializeNode,
  deserializeNode,
  serializeRelationship,
  deserializeRelationship,
  serializeCounter,
  deserializeCounter,
  existsMarker,
  // Algorithms
  bfsShortestPath,
  dijkstraShortestPath,
} from './pure/index.js';

/**
 * PolyGraph — Embeddable graph database engine.
 *
 * The thin I/O shell. Reads and writes through the storage adapter,
 * delegates all logic to pure functions.
 */
export class PolyGraph {
  private adapter: StorageAdapter;
  private indexes: Map<string, Set<string>> = new Map();
  private counterLock: Promise<void> = Promise.resolve();

  constructor(options?: PolyGraphOptions) {
    this.adapter = options?.adapter ?? new MemoryAdapter();
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  async open(): Promise<void> {
    await this.adapter.open();
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }

  // ─── Node Operations ───────────────────────────────────────────────

  async createNode(labels: string[], properties: Record<string, any> = {}): Promise<Node> {
    const id = randomUUID();
    const node: Node = { id, labels, properties };
    const marker = existsMarker();

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    ops.push({ type: 'put', key: nodeKey(id), value: serializeNode(node) });

    for (const label of labels) {
      ops.push({ type: 'put', key: nodeLabelKey(id, label), value: marker });
      ops.push({ type: 'put', key: labelIndexKey(label, id), value: marker });
    }

    // Property indexes
    for (const label of labels) {
      for (const [propKey, propValue] of Object.entries(properties)) {
        if (this.indexes.has(`${label}:${propKey}`)) {
          ops.push({ type: 'put', key: propIndexKey(label, propKey, propValue, id), value: marker });
        }
      }
    }

    await this.adapter.batch(ops);
    await this.incrementCounter(COUNTER_NODE_COUNT);

    return node;
  }

  async getNode(id: NodeId): Promise<Node | null> {
    const buffer = await this.adapter.get(nodeKey(id));
    if (!buffer) return null;
    return deserializeNode(buffer);
  }

  async updateNode(id: NodeId, properties: Record<string, any>): Promise<Node> {
    const node = await this.getNode(id);
    if (!node) throw new Error(`Node ${id} not found`);

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];
    const marker = existsMarker();

    // Remove old property index entries for changed properties
    for (const label of node.labels) {
      for (const [propKey, oldValue] of Object.entries(node.properties)) {
        if (this.indexes.has(`${label}:${propKey}`) && propKey in properties && properties[propKey] !== oldValue) {
          ops.push({ type: 'del', key: propIndexKey(label, propKey, oldValue, id) });
        }
      }
    }

    node.properties = { ...node.properties, ...properties };
    ops.push({ type: 'put', key: nodeKey(id), value: serializeNode(node) });

    // Add new property index entries
    for (const label of node.labels) {
      for (const [propKey, newValue] of Object.entries(properties)) {
        if (this.indexes.has(`${label}:${propKey}`)) {
          ops.push({ type: 'put', key: propIndexKey(label, propKey, newValue, id), value: marker });
        }
      }
    }

    await this.adapter.batch(ops);
    return node;
  }

  async deleteNode(id: NodeId): Promise<void> {
    const node = await this.getNode(id);
    if (!node) return;

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    // Cascade delete outgoing relationships
    for await (const { key } of this.adapter.scan(nodeOutPrefix(id))) {
      const relId = lastSegment(key);
      const rel = await this.getRelationship(relId);
      if (rel) await this.deleteRelationshipInternal(rel, ops);
    }

    // Cascade delete incoming relationships
    for await (const { key } of this.adapter.scan(nodeInPrefix(id))) {
      const relId = lastSegment(key);
      const rel = await this.getRelationship(relId);
      if (rel) await this.deleteRelationshipInternal(rel, ops);
    }

    // Delete label markers and label index entries
    for (const label of node.labels) {
      ops.push({ type: 'del', key: nodeLabelKey(id, label) });
      ops.push({ type: 'del', key: labelIndexKey(label, id) });
    }

    // Delete property index entries
    for (const label of node.labels) {
      for (const [propKey, propValue] of Object.entries(node.properties)) {
        if (this.indexes.has(`${label}:${propKey}`)) {
          ops.push({ type: 'del', key: propIndexKey(label, propKey, propValue, id) });
        }
      }
    }

    ops.push({ type: 'del', key: nodeKey(id) });
    await this.adapter.batch(ops);
    await this.decrementCounter(COUNTER_NODE_COUNT);
  }

  async findNodes(label: string, filter?: PropertyFilter): Promise<Node[]> {
    const nodes: Node[] = [];

    // Try indexed lookup first
    if (filter) {
      for (const [propKey, condition] of Object.entries(filter)) {
        if (this.indexes.has(`${label}:${propKey}`)) {
          const value = extractEqualityValue(condition);
          if (value !== undefined) {
            const prefix = propIndexValuePrefix(label, propKey, value);
            for await (const { key } of this.adapter.scan(prefix)) {
              const nodeId = stripPrefix(key, prefix);
              const node = await this.getNode(nodeId);
              if (node && matchesFilter(node.properties, filter)) {
                nodes.push(node);
              }
            }
            return nodes;
          }
        }
      }
    }

    // Fall back to label index scan
    const prefix = labelIndexPrefix(label);
    for await (const { key } of this.adapter.scan(prefix)) {
      const nodeId = stripPrefix(key, prefix);
      const node = await this.getNode(nodeId);
      if (node && (!filter || matchesFilter(node.properties, filter))) {
        nodes.push(node);
      }
    }

    return nodes;
  }

  async addLabel(id: NodeId, label: string): Promise<Node> {
    const node = await this.getNode(id);
    if (!node) throw new Error(`Node ${id} not found`);
    if (node.labels.includes(label)) return node;

    node.labels.push(label);
    const marker = existsMarker();
    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    ops.push({ type: 'put', key: nodeKey(id), value: serializeNode(node) });
    ops.push({ type: 'put', key: nodeLabelKey(id, label), value: marker });
    ops.push({ type: 'put', key: labelIndexKey(label, id), value: marker });

    for (const [propKey, propValue] of Object.entries(node.properties)) {
      if (this.indexes.has(`${label}:${propKey}`)) {
        ops.push({ type: 'put', key: propIndexKey(label, propKey, propValue, id), value: marker });
      }
    }

    await this.adapter.batch(ops);
    return node;
  }

  async removeLabel(id: NodeId, label: string): Promise<Node> {
    const node = await this.getNode(id);
    if (!node) throw new Error(`Node ${id} not found`);

    const idx = node.labels.indexOf(label);
    if (idx === -1) return node;

    node.labels.splice(idx, 1);
    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    ops.push({ type: 'put', key: nodeKey(id), value: serializeNode(node) });
    ops.push({ type: 'del', key: nodeLabelKey(id, label) });
    ops.push({ type: 'del', key: labelIndexKey(label, id) });

    for (const [propKey, propValue] of Object.entries(node.properties)) {
      if (this.indexes.has(`${label}:${propKey}`)) {
        ops.push({ type: 'del', key: propIndexKey(label, propKey, propValue, id) });
      }
    }

    await this.adapter.batch(ops);
    return node;
  }

  async hasLabel(id: NodeId, label: string): Promise<boolean> {
    const buffer = await this.adapter.get(nodeLabelKey(id, label));
    return buffer !== null;
  }

  // ─── Relationship Operations ───────────────────────────────────────

  async createRelationship(
    startNode: NodeId,
    endNode: NodeId,
    type: string,
    properties: Record<string, any> = {}
  ): Promise<Relationship> {
    const start = await this.getNode(startNode);
    const end = await this.getNode(endNode);
    if (!start || !end) {
      throw new Error(`Cannot create relationship: node ${!start ? startNode : endNode} not found`);
    }

    const id = randomUUID();
    const relationship: Relationship = { id, type, startNode, endNode, properties };
    const marker = existsMarker();

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];
    ops.push({ type: 'put', key: relKey(id), value: serializeRelationship(relationship) });
    ops.push({ type: 'put', key: nodeOutKey(startNode, type, id), value: marker });
    ops.push({ type: 'put', key: nodeInKey(endNode, type, id), value: marker });

    await this.adapter.batch(ops);
    await this.incrementCounter(COUNTER_REL_COUNT);

    return relationship;
  }

  async getRelationship(id: RelId): Promise<Relationship | null> {
    const buffer = await this.adapter.get(relKey(id));
    if (!buffer) return null;
    return deserializeRelationship(buffer);
  }

  async updateRelationship(id: RelId, properties: Record<string, any>): Promise<Relationship> {
    const rel = await this.getRelationship(id);
    if (!rel) throw new Error(`Relationship ${id} not found`);

    rel.properties = { ...rel.properties, ...properties };
    await this.adapter.put(relKey(id), serializeRelationship(rel));
    return rel;
  }

  async deleteRelationship(id: RelId): Promise<void> {
    const rel = await this.getRelationship(id);
    if (!rel) return;

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];
    await this.deleteRelationshipInternal(rel, ops);
    await this.adapter.batch(ops);
  }

  private async deleteRelationshipInternal(
    rel: Relationship,
    ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }>
  ): Promise<void> {
    ops.push({ type: 'del', key: relKey(rel.id) });
    ops.push({ type: 'del', key: nodeOutKey(rel.startNode, rel.type, rel.id) });
    ops.push({ type: 'del', key: nodeInKey(rel.endNode, rel.type, rel.id) });
    await this.decrementCounter(COUNTER_REL_COUNT);
  }

  async findRelationships(type: string, filter?: PropertyFilter): Promise<Relationship[]> {
    const relationships: Relationship[] = [];

    for await (const { value } of this.adapter.scan(relPrefix())) {
      const rel = deserializeRelationship(value);
      if (rel.type === type && (!filter || matchesFilter(rel.properties, filter))) {
        relationships.push(rel);
      }
    }

    return relationships;
  }

  // ─── Traversal ─────────────────────────────────────────────────────

  traverse(startNode: NodeId): TraversalBuilder {
    return new TraversalBuilder(this, startNode);
  }

  async shortestPath(from: NodeId, to: NodeId, options?: PathOptions): Promise<Path | null> {
    const { relationshipTypes, direction = 'both', maxDepth = Infinity, costProperty } = options ?? {};

    const startNode = await this.getNode(from);
    if (!startNode) return null;

    // Bind getNeighbors to this instance — the pure algorithms need it as a callback
    const getNeighbors = this.getNeighbors.bind(this);
    const getNode = this.getNode.bind(this);

    if (costProperty) {
      return dijkstraShortestPath(getNeighbors, getNode, from, to, costProperty, relationshipTypes, direction, maxDepth);
    } else {
      return bfsShortestPath(getNeighbors, from, to, startNode, relationshipTypes, direction, maxDepth);
    }
  }

  async neighborhood(nodeId: NodeId, depth: number, options?: NeighborhoodOptions): Promise<Subgraph> {
    const { relationshipTypes, direction = 'both', nodeFilter, relFilter } = options ?? {};

    const nodesMap = new Map<NodeId, Node>();
    const relsMap = new Map<RelId, Relationship>();
    const visited = new Set<NodeId>();
    const queue: Array<{ nodeId: NodeId; currentDepth: number }> = [];

    const startNode = await this.getNode(nodeId);
    if (!startNode) return { nodes: [], relationships: [] };

    nodesMap.set(nodeId, startNode);
    queue.push({ nodeId, currentDepth: 0 });
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.currentDepth >= depth) continue;

      const neighbors = await this.getNeighbors(current.nodeId, relationshipTypes, direction);

      for (const { node, relationship } of neighbors) {
        if (relFilter && !matchesFilter(relationship.properties, relFilter)) continue;
        if (nodeFilter && !matchesFilter(node.properties, nodeFilter)) continue;

        relsMap.set(relationship.id, relationship);

        if (!visited.has(node.id)) {
          visited.add(node.id);
          nodesMap.set(node.id, node);
          queue.push({ nodeId: node.id, currentDepth: current.currentDepth + 1 });
        }
      }
    }

    return {
      nodes: Array.from(nodesMap.values()),
      relationships: Array.from(relsMap.values()),
    };
  }

  /**
   * Gets all neighbors of a node.
   * This is the I/O boundary — it reads from the adapter.
   * Pure algorithms call this via callback injection.
   */
  async getNeighbors(
    nodeId: NodeId,
    relationshipTypes?: string[],
    direction: 'outgoing' | 'incoming' | 'both' = 'both'
  ): Promise<Array<{ node: Node; relationship: Relationship }>> {
    const neighbors: Array<{ node: Node; relationship: Relationship }> = [];

    const directions: Array<'o' | 'i'> = [];
    if (direction === 'outgoing' || direction === 'both') directions.push('o');
    if (direction === 'incoming' || direction === 'both') directions.push('i');

    for (const dir of directions) {
      const prefixes = (relationshipTypes && relationshipTypes.length > 0)
        ? relationshipTypes.map((t) => dir === 'o' ? nodeOutTypePrefix(nodeId, t) : nodeInTypePrefix(nodeId, t))
        : [dir === 'o' ? nodeOutPrefix(nodeId) : nodeInPrefix(nodeId)];

      for (const prefix of prefixes) {
        for await (const { key } of this.adapter.scan(prefix)) {
          const relId = lastSegment(key);
          const rel = await this.getRelationship(relId);
          if (!rel) continue;

          const neighborId = dir === 'o' ? rel.endNode : rel.startNode;
          const neighbor = await this.getNode(neighborId);
          if (neighbor) {
            neighbors.push({ node: neighbor, relationship: rel });
          }
        }
      }
    }

    return neighbors;
  }

  // ─── Transactions ──────────────────────────────────────────────────

  async withTx<T>(fn: (graph: PolyGraph) => Promise<T>): Promise<T> {
    try {
      return await fn(this);
    } catch (error) {
      throw error;
    }
  }

  // ─── Index Management ──────────────────────────────────────────────

  async createIndex(label: string, propertyKey: string): Promise<void> {
    const indexId = `${label}:${propertyKey}`;
    if (this.indexes.has(indexId)) return;

    this.indexes.set(indexId, new Set([label]));

    const nodes = await this.findNodes(label);
    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];
    const marker = existsMarker();

    for (const node of nodes) {
      if (propertyKey in node.properties) {
        ops.push({ type: 'put', key: propIndexKey(label, propertyKey, node.properties[propertyKey], node.id), value: marker });
      }
    }

    if (ops.length > 0) await this.adapter.batch(ops);
  }

  async dropIndex(label: string, propertyKey: string): Promise<void> {
    const indexId = `${label}:${propertyKey}`;
    if (!this.indexes.has(indexId)) return;

    this.indexes.delete(indexId);

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];
    for await (const { key } of this.adapter.scan(propIndexPrefix(label, propertyKey))) {
      ops.push({ type: 'del', key });
    }

    if (ops.length > 0) await this.adapter.batch(ops);
  }

  // ─── Stats ─────────────────────────────────────────────────────────

  async stats(): Promise<{ nodeCount: number; relationshipCount: number; indexCount: number }> {
    const nodeCount = await this.getCounter(COUNTER_NODE_COUNT);
    const relationshipCount = await this.getCounter(COUNTER_REL_COUNT);
    return { nodeCount, relationshipCount, indexCount: this.indexes.size };
  }

  // ─── Counter I/O (private) ─────────────────────────────────────────

  private async incrementCounter(key: string): Promise<void> {
    await this.withCounterLock(async () => {
      const current = await this.getCounter(key);
      await this.adapter.put(key, serializeCounter(current + 1));
    });
  }

  private async decrementCounter(key: string): Promise<void> {
    await this.withCounterLock(async () => {
      const current = await this.getCounter(key);
      await this.adapter.put(key, serializeCounter(Math.max(0, current - 1)));
    });
  }

  private async withCounterLock(fn: () => Promise<void>): Promise<void> {
    const prev = this.counterLock;
    let resolve: () => void;
    this.counterLock = new Promise<void>((r) => { resolve = r; });
    try {
      await prev;
      await fn();
    } finally {
      resolve!();
    }
  }

  private async getCounter(key: string): Promise<number> {
    const buffer = await this.adapter.get(key);
    if (!buffer) return 0;
    return deserializeCounter(buffer);
  }
}
