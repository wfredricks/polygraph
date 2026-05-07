/**
 * PolyGraph Engine — Core graph database implementation
 *
 * Why: Provides the main graph operations (nodes, relationships, traversal) on top of
 * a pluggable storage adapter. Implements index-free adjacency using carefully designed
 * key prefixes for efficient graph traversal.
 *
 * What: The PolyGraph class exposes CRUD operations for nodes and relationships,
 * traversal APIs, transaction support, and index management.
 */

import { randomUUID } from 'crypto';
import { pack, unpack } from 'msgpackr';
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

/**
 * Main PolyGraph engine class.
 * Provides graph database operations on top of a storage adapter.
 */
export class PolyGraph {
  private adapter: StorageAdapter;
  private indexes: Map<string, Set<string>> = new Map(); // label:propKey -> Set<label>
  /** Simple mutex for counter operations to prevent concurrent read-modify-write races */
  private counterLock: Promise<void> = Promise.resolve();

  constructor(options?: PolyGraphOptions) {
    this.adapter = options?.adapter ?? new MemoryAdapter();
  }

  /**
   * Opens the graph database.
   * Must be called before any operations.
   */
  async open(): Promise<void> {
    await this.adapter.open();
  }

  /**
   * Closes the graph database and releases resources.
   */
  async close(): Promise<void> {
    await this.adapter.close();
  }

  // ─── Node Operations ───────────────────────────────────────────────

  /**
   * Creates a new node with the given labels and properties.
   *
   * Why: Nodes are the primary entities in a labeled property graph.
   * Each node gets a unique ID (UUID) and is stored with its labels and properties.
   *
   * @param labels - Array of label strings (e.g., ['Person', 'Employee'])
   * @param properties - Optional key-value properties
   * @returns The created node
   */
  async createNode(labels: string[], properties: Record<string, any> = {}): Promise<Node> {
    const id = randomUUID();
    const node: Node = { id, labels, properties };

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    // Store the node data
    ops.push({
      type: 'put',
      key: `n:${id}`,
      value: Buffer.from(pack(node)),
    });

    // Create label markers and label index entries
    for (const label of labels) {
      ops.push({
        type: 'put',
        key: `n:${id}:l:${label}`,
        value: Buffer.from([1]),
      });
      ops.push({
        type: 'put',
        key: `i:l:${label}:${id}`,
        value: Buffer.from([1]),
      });
    }

    // Update property indexes if they exist
    for (const label of labels) {
      for (const [propKey, propValue] of Object.entries(properties)) {
        const indexKey = `${label}:${propKey}`;
        if (this.indexes.has(indexKey)) {
          ops.push({
            type: 'put',
            key: `i:p:${label}:${propKey}:${String(propValue)}:${id}`,
            value: Buffer.from([1]),
          });
        }
      }
    }

    await this.adapter.batch(ops);

    // Increment node count
    await this.incrementCounter('m:nodeCount');

    return node;
  }

  /**
   * Retrieves a node by its ID.
   *
   * @param id - The node ID
   * @returns The node, or null if not found
   */
  async getNode(id: NodeId): Promise<Node | null> {
    const buffer = await this.adapter.get(`n:${id}`);
    if (!buffer) return null;
    return unpack(buffer) as Node;
  }

  /**
   * Updates a node's properties (merges with existing properties).
   *
   * Why: Property updates should preserve existing properties unless explicitly overridden.
   *
   * @param id - The node ID
   * @param properties - Properties to merge
   * @returns The updated node
   */
  async updateNode(id: NodeId, properties: Record<string, any>): Promise<Node> {
    const node = await this.getNode(id);
    if (!node) {
      throw new Error(`Node ${id} not found`);
    }

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    // Remove old property index entries
    for (const label of node.labels) {
      for (const [propKey, oldValue] of Object.entries(node.properties)) {
        const indexKey = `${label}:${propKey}`;
        if (this.indexes.has(indexKey) && propKey in properties && properties[propKey] !== oldValue) {
          ops.push({
            type: 'del',
            key: `i:p:${label}:${propKey}:${String(oldValue)}:${id}`,
          });
        }
      }
    }

    // Merge properties
    node.properties = { ...node.properties, ...properties };

    // Store updated node
    ops.push({
      type: 'put',
      key: `n:${id}`,
      value: Buffer.from(pack(node)),
    });

    // Add new property index entries
    for (const label of node.labels) {
      for (const [propKey, newValue] of Object.entries(properties)) {
        const indexKey = `${label}:${propKey}`;
        if (this.indexes.has(indexKey)) {
          ops.push({
            type: 'put',
            key: `i:p:${label}:${propKey}:${String(newValue)}:${id}`,
            value: Buffer.from([1]),
          });
        }
      }
    }

    await this.adapter.batch(ops);
    return node;
  }

  /**
   * Deletes a node and all its connected relationships.
   *
   * Why: Cascade deletion ensures graph consistency — no dangling relationships.
   *
   * @param id - The node ID to delete
   */
  async deleteNode(id: NodeId): Promise<void> {
    const node = await this.getNode(id);
    if (!node) return;

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    // Delete all outgoing relationships
    for await (const { key } of this.adapter.scan(`n:${id}:o:`)) {
      const parts = key.split(':');
      const relId = parts[parts.length - 1];
      const rel = await this.getRelationship(relId);
      if (rel) {
        await this.deleteRelationshipInternal(rel, ops);
      }
    }

    // Delete all incoming relationships
    for await (const { key } of this.adapter.scan(`n:${id}:i:`)) {
      const parts = key.split(':');
      const relId = parts[parts.length - 1];
      const rel = await this.getRelationship(relId);
      if (rel) {
        await this.deleteRelationshipInternal(rel, ops);
      }
    }

    // Delete label markers and index entries
    for (const label of node.labels) {
      ops.push({ type: 'del', key: `n:${id}:l:${label}` });
      ops.push({ type: 'del', key: `i:l:${label}:${id}` });
    }

    // Delete property index entries
    for (const label of node.labels) {
      for (const [propKey, propValue] of Object.entries(node.properties)) {
        const indexKey = `${label}:${propKey}`;
        if (this.indexes.has(indexKey)) {
          ops.push({
            type: 'del',
            key: `i:p:${label}:${propKey}:${String(propValue)}:${id}`,
          });
        }
      }
    }

    // Delete the node itself
    ops.push({ type: 'del', key: `n:${id}` });

    await this.adapter.batch(ops);
    await this.decrementCounter('m:nodeCount');
  }

  /**
   * Finds nodes by label, optionally filtered by property conditions.
   *
   * Why: Label-based lookup is the primary way to find nodes in a graph.
   * Property filters allow narrowing results without a full scan.
   *
   * @param label - The label to search for
   * @param filter - Optional property filter
   * @returns Array of matching nodes
   */
  async findNodes(label: string, filter?: PropertyFilter): Promise<Node[]> {
    const nodes: Node[] = [];

    // If we have a property filter with exact values and an index exists, use it
    if (filter) {
      for (const [propKey, condition] of Object.entries(filter)) {
        const indexKey = `${label}:${propKey}`;
        if (this.indexes.has(indexKey)) {
          // Check if this is a simple equality filter
          const value = this.extractEqualityValue(condition);
          if (value !== undefined) {
            // Use property index
            const scanPrefix = `i:p:${label}:${propKey}:${String(value)}:`;
            for await (const { key } of this.adapter.scan(scanPrefix)) {
              const nodeId = key.slice(scanPrefix.length);
              const node = await this.getNode(nodeId);
              if (node && this.matchesFilter(node.properties, filter)) {
                nodes.push(node);
              }
            }
            return nodes;
          }
        }
      }
    }

    // Fall back to label index scan with filter
    for await (const { key } of this.adapter.scan(`i:l:${label}:`)) {
      const nodeId = key.substring(`i:l:${label}:`.length);
      const node = await this.getNode(nodeId);
      if (node && (!filter || this.matchesFilter(node.properties, filter))) {
        nodes.push(node);
      }
    }

    return nodes;
  }

  /**
   * Adds a label to a node.
   *
   * @param id - The node ID
   * @param label - The label to add
   * @returns The updated node
   */
  async addLabel(id: NodeId, label: string): Promise<Node> {
    const node = await this.getNode(id);
    if (!node) {
      throw new Error(`Node ${id} not found`);
    }

    if (node.labels.includes(label)) {
      return node; // Already has this label
    }

    node.labels.push(label);

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    ops.push({
      type: 'put',
      key: `n:${id}`,
      value: Buffer.from(pack(node)),
    });

    ops.push({
      type: 'put',
      key: `n:${id}:l:${label}`,
      value: Buffer.from([1]),
    });

    ops.push({
      type: 'put',
      key: `i:l:${label}:${id}`,
      value: Buffer.from([1]),
    });

    // Add property index entries for this new label
    for (const [propKey, propValue] of Object.entries(node.properties)) {
      const indexKey = `${label}:${propKey}`;
      if (this.indexes.has(indexKey)) {
        ops.push({
          type: 'put',
          key: `i:p:${label}:${propKey}:${String(propValue)}:${id}`,
          value: Buffer.from([1]),
        });
      }
    }

    await this.adapter.batch(ops);
    return node;
  }

  /**
   * Removes a label from a node.
   *
   * @param id - The node ID
   * @param label - The label to remove
   * @returns The updated node
   */
  async removeLabel(id: NodeId, label: string): Promise<Node> {
    const node = await this.getNode(id);
    if (!node) {
      throw new Error(`Node ${id} not found`);
    }

    const labelIndex = node.labels.indexOf(label);
    if (labelIndex === -1) {
      return node; // Doesn't have this label
    }

    node.labels.splice(labelIndex, 1);

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    ops.push({
      type: 'put',
      key: `n:${id}`,
      value: Buffer.from(pack(node)),
    });

    ops.push({ type: 'del', key: `n:${id}:l:${label}` });
    ops.push({ type: 'del', key: `i:l:${label}:${id}` });

    // Remove property index entries for this label
    for (const [propKey, propValue] of Object.entries(node.properties)) {
      const indexKey = `${label}:${propKey}`;
      if (this.indexes.has(indexKey)) {
        ops.push({
          type: 'del',
          key: `i:p:${label}:${propKey}:${String(propValue)}:${id}`,
        });
      }
    }

    await this.adapter.batch(ops);
    return node;
  }

  /**
   * Checks if a node has a specific label.
   *
   * @param id - The node ID
   * @param label - The label to check
   * @returns True if the node has the label
   */
  async hasLabel(id: NodeId, label: string): Promise<boolean> {
    const buffer = await this.adapter.get(`n:${id}:l:${label}`);
    return buffer !== null;
  }

  // ─── Relationship Operations ───────────────────────────────────────

  /**
   * Creates a relationship between two nodes.
   *
   * Why: Relationships connect nodes and enable graph traversal.
   * We store adjacency lists with each node for index-free traversal.
   *
   * @param startNode - The source node ID
   * @param endNode - The target node ID
   * @param type - The relationship type
   * @param properties - Optional properties
   * @returns The created relationship
   */
  async createRelationship(
    startNode: NodeId,
    endNode: NodeId,
    type: string,
    properties: Record<string, any> = {}
  ): Promise<Relationship> {
    // Verify nodes exist
    const start = await this.getNode(startNode);
    const end = await this.getNode(endNode);
    if (!start || !end) {
      throw new Error(`Cannot create relationship: node ${!start ? startNode : endNode} not found`);
    }

    const id = randomUUID();
    const relationship: Relationship = { id, type, startNode, endNode, properties };

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    // Store relationship
    ops.push({
      type: 'put',
      key: `r:${id}`,
      value: Buffer.from(pack(relationship)),
    });

    // Store adjacency markers
    ops.push({
      type: 'put',
      key: `n:${startNode}:o:${type}:${id}`,
      value: Buffer.from([1]),
    });

    ops.push({
      type: 'put',
      key: `n:${endNode}:i:${type}:${id}`,
      value: Buffer.from([1]),
    });

    await this.adapter.batch(ops);
    await this.incrementCounter('m:relCount');

    return relationship;
  }

  /**
   * Retrieves a relationship by its ID.
   *
   * @param id - The relationship ID
   * @returns The relationship, or null if not found
   */
  async getRelationship(id: RelId): Promise<Relationship | null> {
    const buffer = await this.adapter.get(`r:${id}`);
    if (!buffer) return null;
    return unpack(buffer) as Relationship;
  }

  /**
   * Updates a relationship's properties.
   *
   * @param id - The relationship ID
   * @param properties - Properties to merge
   * @returns The updated relationship
   */
  async updateRelationship(id: RelId, properties: Record<string, any>): Promise<Relationship> {
    const rel = await this.getRelationship(id);
    if (!rel) {
      throw new Error(`Relationship ${id} not found`);
    }

    rel.properties = { ...rel.properties, ...properties };

    await this.adapter.put(`r:${id}`, Buffer.from(pack(rel)));
    return rel;
  }

  /**
   * Deletes a relationship.
   *
   * @param id - The relationship ID
   */
  async deleteRelationship(id: RelId): Promise<void> {
    const rel = await this.getRelationship(id);
    if (!rel) return;

    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];
    await this.deleteRelationshipInternal(rel, ops);
    await this.adapter.batch(ops);
    // Counter already decremented inside deleteRelationshipInternal
  }

  /**
   * Internal helper to delete a relationship (adds ops to batch).
   */
  private async deleteRelationshipInternal(
    rel: Relationship,
    ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }>
  ): Promise<void> {
    ops.push({ type: 'del', key: `r:${rel.id}` });
    ops.push({ type: 'del', key: `n:${rel.startNode}:o:${rel.type}:${rel.id}` });
    ops.push({ type: 'del', key: `n:${rel.endNode}:i:${rel.type}:${rel.id}` });
    await this.decrementCounter('m:relCount');
  }

  /**
   * Finds relationships by type, optionally filtered by properties.
   *
   * @param type - The relationship type
   * @param filter - Optional property filter
   * @returns Array of matching relationships
   */
  async findRelationships(type: string, filter?: PropertyFilter): Promise<Relationship[]> {
    const relationships: Relationship[] = [];

    // Scan all relationship keys with the given type
    // This is inefficient but works for now — would need a type index for better performance
    for await (const { value } of this.adapter.scan('r:')) {
      const rel = unpack(value) as Relationship;
      if (rel.type === type && (!filter || this.matchesFilter(rel.properties, filter))) {
        relationships.push(rel);
      }
    }

    return relationships;
  }

  // ─── Traversal Operations ──────────────────────────────────────────

  /**
   * Creates a traversal builder starting from the given node.
   *
   * Why: Fluent API makes graph traversals readable and composable.
   *
   * @param startNode - The node ID to start from
   * @returns A TraversalBuilder instance
   */
  traverse(startNode: NodeId): TraversalBuilder {
    return new TraversalBuilder(this, startNode);
  }

  /**
   * Finds the shortest path between two nodes using BFS (or Dijkstra if costProperty is specified).
   *
   * Why: Shortest path is a fundamental graph algorithm used for chain analysis,
   * dependency tracking, and relationship discovery.
   *
   * @param from - Start node ID
   * @param to - End node ID
   * @param options - Path finding options
   * @returns The shortest path, or null if no path exists
   */
  async shortestPath(from: NodeId, to: NodeId, options?: PathOptions): Promise<Path | null> {
    const { relationshipTypes, direction = 'both', maxDepth = Infinity, costProperty } = options ?? {};

    if (costProperty) {
      return this.dijkstraPath(from, to, costProperty, relationshipTypes, direction, maxDepth);
    } else {
      return this.bfsPath(from, to, relationshipTypes, direction, maxDepth);
    }
  }

  /**
   * BFS-based shortest path (unweighted).
   */
  private async bfsPath(
    from: NodeId,
    to: NodeId,
    relationshipTypes?: string[],
    direction: 'outgoing' | 'incoming' | 'both' = 'both',
    maxDepth = Infinity
  ): Promise<Path | null> {
    const queue: Array<{ nodeId: NodeId; path: { nodes: Node[]; relationships: Relationship[] } }> = [];
    const visited = new Set<NodeId>();

    const startNode = await this.getNode(from);
    if (!startNode) return null;

    queue.push({ nodeId: from, path: { nodes: [startNode], relationships: [] } });
    visited.add(from);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.nodeId === to) {
        return {
          ...current.path,
          length: current.path.relationships.length,
        };
      }

      if (current.path.relationships.length >= maxDepth) {
        continue;
      }

      // Get neighbors
      const neighbors = await this.getNeighbors(current.nodeId, relationshipTypes, direction);

      for (const { node, relationship } of neighbors) {
        if (!visited.has(node.id)) {
          visited.add(node.id);
          queue.push({
            nodeId: node.id,
            path: {
              nodes: [...current.path.nodes, node],
              relationships: [...current.path.relationships, relationship],
            },
          });
        }
      }
    }

    return null;
  }

  /**
   * Dijkstra's shortest path (weighted).
   */
  private async dijkstraPath(
    from: NodeId,
    to: NodeId,
    costProperty: string,
    relationshipTypes?: string[],
    direction: 'outgoing' | 'incoming' | 'both' = 'both',
    maxDepth = Infinity
  ): Promise<Path | null> {
    const distances = new Map<NodeId, number>();
    const previous = new Map<NodeId, { node: Node; relationship: Relationship }>();
    const unvisited = new Set<NodeId>();

    const startNode = await this.getNode(from);
    if (!startNode) return null;

    distances.set(from, 0);
    unvisited.add(from);

    while (unvisited.size > 0) {
      // Find node with minimum distance
      let current: NodeId | null = null;
      let minDist = Infinity;
      for (const nodeId of unvisited) {
        const dist = distances.get(nodeId) ?? Infinity;
        if (dist < minDist) {
          minDist = dist;
          current = nodeId;
        }
      }

      if (!current || minDist === Infinity) break;
      unvisited.delete(current);

      if (current === to) {
        // Reconstruct path
        const path: { nodes: Node[]; relationships: Relationship[] } = {
          nodes: [],
          relationships: [],
        };

        let curr: NodeId | undefined = to;
        while (curr) {
          const node = await this.getNode(curr);
          if (!node) break;
          path.nodes.unshift(node);

          const prev = previous.get(curr);
          if (prev) {
            path.relationships.unshift(prev.relationship);
            curr = prev.node.id;
          } else {
            break;
          }
        }

        return { ...path, length: path.relationships.length };
      }

      const currentDist = distances.get(current) ?? 0;
      if (currentDist >= maxDepth) continue;

      // Check neighbors
      const neighbors = await this.getNeighbors(current, relationshipTypes, direction);

      for (const { node, relationship } of neighbors) {
        const cost = Number(relationship.properties[costProperty] ?? 1);
        const alt = currentDist + cost;

        if (alt < (distances.get(node.id) ?? Infinity)) {
          distances.set(node.id, alt);
          previous.set(node.id, { node: await this.getNode(current)!, relationship });
          unvisited.add(node.id);
        }
      }
    }

    return null;
  }

  /**
   * Returns the neighborhood (subgraph) around a node up to a given depth.
   *
   * Why: Useful for getting context around an entity — all related nodes and relationships.
   *
   * @param nodeId - The center node
   * @param depth - How many hops to traverse
   * @param options - Optional filters
   * @returns A subgraph containing nodes and relationships
   */
  async neighborhood(nodeId: NodeId, depth: number, options?: NeighborhoodOptions): Promise<Subgraph> {
    const { relationshipTypes, direction = 'both', nodeFilter, relFilter } = options ?? {};

    const nodes = new Map<NodeId, Node>();
    const relationships = new Map<RelId, Relationship>();
    const visited = new Set<NodeId>();
    const queue: Array<{ nodeId: NodeId; currentDepth: number }> = [];

    const startNode = await this.getNode(nodeId);
    if (!startNode) {
      return { nodes: [], relationships: [] };
    }

    nodes.set(nodeId, startNode);
    queue.push({ nodeId, currentDepth: 0 });
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.currentDepth >= depth) {
        continue;
      }

      const neighbors = await this.getNeighbors(current.nodeId, relationshipTypes, direction);

      for (const { node, relationship } of neighbors) {
        // Apply filters
        if (relFilter && !this.matchesFilter(relationship.properties, relFilter)) {
          continue;
        }
        if (nodeFilter && !this.matchesFilter(node.properties, nodeFilter)) {
          continue;
        }

        relationships.set(relationship.id, relationship);

        if (!visited.has(node.id)) {
          visited.add(node.id);
          nodes.set(node.id, node);
          queue.push({ nodeId: node.id, currentDepth: current.currentDepth + 1 });
        }
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      relationships: Array.from(relationships.values()),
    };
  }

  /**
   * Gets all neighbors of a node (helper for traversal algorithms).
   *
   * @internal
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
      if (relationshipTypes && relationshipTypes.length > 0) {
        // Scan for specific relationship types
        for (const type of relationshipTypes) {
          const prefix = `n:${nodeId}:${dir}:${type}:`;
          for await (const { key } of this.adapter.scan(prefix)) {
            const parts = key.split(':');
            const relId = parts[parts.length - 1];
            const rel = await this.getRelationship(relId);
            if (!rel) continue;

            const neighborId = dir === 'o' ? rel.endNode : rel.startNode;
            const neighbor = await this.getNode(neighborId);
            if (neighbor) {
              neighbors.push({ node: neighbor, relationship: rel });
            }
          }
        }
      } else {
        // Scan for all relationship types
        const prefix = `n:${nodeId}:${dir}:`;
        for await (const { key } of this.adapter.scan(prefix)) {
          const parts = key.split(':');
          const relId = parts[parts.length - 1];
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

  // ─── Transaction Support ───────────────────────────────────────────

  /**
   * Executes a function within a transaction context.
   *
   * Why: Transactions ensure atomicity — all operations succeed or all fail.
   * Critical for maintaining graph consistency.
   *
   * @param fn - The function to execute
   * @returns The function's return value
   */
  async withTx<T>(fn: (graph: PolyGraph) => Promise<T>): Promise<T> {
    // For now, we just execute the function and rely on batch operations
    // A full transaction implementation would use a TransactionContext and rollback capability
    try {
      return await fn(this);
    } catch (error) {
      // In a real implementation, we'd rollback here
      throw error;
    }
  }

  // ─── Index Management ──────────────────────────────────────────────

  /**
   * Creates a property index for faster lookups.
   *
   * Why: Indexes speed up findNodes() queries that filter by property values.
   *
   * @param label - The node label
   * @param propertyKey - The property to index
   */
  async createIndex(label: string, propertyKey: string): Promise<void> {
    const indexKey = `${label}:${propertyKey}`;
    if (this.indexes.has(indexKey)) {
      return; // Index already exists
    }

    this.indexes.set(indexKey, new Set([label]));

    // Build index for existing nodes
    const nodes = await this.findNodes(label);
    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];

    for (const node of nodes) {
      if (propertyKey in node.properties) {
        ops.push({
          type: 'put',
          key: `i:p:${label}:${propertyKey}:${String(node.properties[propertyKey])}:${node.id}`,
          value: Buffer.from([1]),
        });
      }
    }

    if (ops.length > 0) {
      await this.adapter.batch(ops);
    }
  }

  /**
   * Drops a property index.
   *
   * @param label - The node label
   * @param propertyKey - The property to remove index for
   */
  async dropIndex(label: string, propertyKey: string): Promise<void> {
    const indexKey = `${label}:${propertyKey}`;
    if (!this.indexes.has(indexKey)) {
      return; // Index doesn't exist
    }

    this.indexes.delete(indexKey);

    // Remove all index entries
    const ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }> = [];
    for await (const { key } of this.adapter.scan(`i:p:${label}:${propertyKey}:`)) {
      ops.push({ type: 'del', key });
    }

    if (ops.length > 0) {
      await this.adapter.batch(ops);
    }
  }

  // ─── Stats ─────────────────────────────────────────────────────────

  /**
   * Returns statistics about the graph.
   *
   * @returns Node count, relationship count, and index count
   */
  async stats(): Promise<{ nodeCount: number; relationshipCount: number; indexCount: number }> {
    const nodeCount = await this.getCounter('m:nodeCount');
    const relationshipCount = await this.getCounter('m:relCount');
    const indexCount = this.indexes.size;

    return { nodeCount, relationshipCount, indexCount };
  }

  // ─── Helper Methods ────────────────────────────────────────────────

  /**
   * Checks if properties match a filter.
   */
  private matchesFilter(properties: Record<string, any>, filter: PropertyFilter): boolean {
    for (const [key, condition] of Object.entries(filter)) {
      const value = properties[key];

      // Handle direct value (implicit $eq)
      if (typeof condition !== 'object' || condition === null) {
        if (value !== condition) return false;
        continue;
      }

      // Handle comparison operators
      if ('$eq' in condition && value !== condition.$eq) return false;
      if ('$neq' in condition && value === condition.$neq) return false;
      if ('$gt' in condition && !(value > condition.$gt)) return false;
      if ('$gte' in condition && !(value >= condition.$gte)) return false;
      if ('$lt' in condition && !(value < condition.$lt)) return false;
      if ('$lte' in condition && !(value <= condition.$lte)) return false;
      if ('$in' in condition && !condition.$in.includes(value)) return false;
      if ('$contains' in condition && !String(value).includes(condition.$contains)) return false;
      if ('$startsWith' in condition && !String(value).startsWith(condition.$startsWith)) return false;
      if ('$endsWith' in condition && !String(value).endsWith(condition.$endsWith)) return false;
      if ('$exists' in condition) {
        const exists = value !== undefined && value !== null;
        if (exists !== condition.$exists) return false;
      }
    }

    return true;
  }

  /**
   * Extracts an equality value from a condition (for index optimization).
   */
  private extractEqualityValue(condition: any): any {
    if (typeof condition !== 'object' || condition === null) {
      return condition; // Direct value
    }
    if ('$eq' in condition) {
      return condition.$eq;
    }
    return undefined;
  }

  /**
   * Increments a counter (serialized to prevent race conditions).
   */
  private async incrementCounter(key: string): Promise<void> {
    await this.withCounterLock(async () => {
      const current = await this.getCounter(key);
      await this.adapter.put(key, Buffer.from(pack(current + 1)));
    });
  }

  /**
   * Decrements a counter (serialized to prevent race conditions).
   */
  private async decrementCounter(key: string): Promise<void> {
    await this.withCounterLock(async () => {
      const current = await this.getCounter(key);
      await this.adapter.put(key, Buffer.from(pack(Math.max(0, current - 1))));
    });
  }

  /**
   * Simple mutex for counter operations.
   * Why: Prevents concurrent read-modify-write races when Promise.all creates multiple nodes.
   */
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

  /**
   * Gets a counter value.
   */
  private async getCounter(key: string): Promise<number> {
    const buffer = await this.adapter.get(key);
    if (!buffer) return 0;
    return unpack(buffer) as number;
  }
}
