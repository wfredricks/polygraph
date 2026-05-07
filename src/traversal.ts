/**
 * TraversalBuilder — Fluent API for graph traversal
 *
 * Why: Graph traversals are complex and benefit from a composable, readable API.
 * The builder pattern allows chaining operations like .outgoing().where().limit().
 *
 * What: Builds a traversal specification and executes it to return nodes, paths, or subgraphs.
 *
 * Key Design Decision:
 * - steps[] defines the repeatable traversal pattern (e.g., .outgoing('KNOWS'))
 * - depth(n) means "repeat the step pattern up to n times" — NOT "number of individual steps"
 * - With one step and depth(3): hop→hop→hop collecting nodes at each level
 * - With two steps [outgoing('A'), outgoing('B')] and depth(2): A→B→A→B collecting at each level
 */

import type {
  Node,
  NodeId,
  Relationship,
  Path,
  Subgraph,
  PropertyFilter,
  Direction,
} from './types.js';
import type { PolyGraph } from './engine.js';
import { matchesFilter } from './pure/filters.js';

interface TraversalStep {
  direction: Direction;
  relationshipTypes?: string[];
  filter?: PropertyFilter;
}

/**
 * Fluent builder for graph traversals.
 * Allows composing traversal operations before executing them.
 */
export class TraversalBuilder {
  private steps: TraversalStep[] = [];
  private maxDepth: number | null = null; // null means auto = steps.length
  private maxLimit = Infinity;
  private uniqueNodes = false;

  constructor(
    private graph: PolyGraph,
    private startNodeId: NodeId
  ) {}

  /**
   * Adds an outgoing traversal step.
   *
   * @param type - Optional relationship type to filter by
   * @returns This builder for chaining
   */
  outgoing(type?: string): this {
    this.steps.push({
      direction: 'outgoing',
      relationshipTypes: type ? [type] : undefined,
    });
    return this;
  }

  /**
   * Adds an incoming traversal step.
   *
   * @param type - Optional relationship type to filter by
   * @returns This builder for chaining
   */
  incoming(type?: string): this {
    this.steps.push({
      direction: 'incoming',
      relationshipTypes: type ? [type] : undefined,
    });
    return this;
  }

  /**
   * Adds a bidirectional traversal step.
   *
   * @param type - Optional relationship type to filter by
   * @returns This builder for chaining
   */
  both(type?: string): this {
    this.steps.push({
      direction: 'both',
      relationshipTypes: type ? [type] : undefined,
    });
    return this;
  }

  /**
   * Adds a filter to the most recent traversal step.
   *
   * Why: Allows filtering nodes at each step of the traversal.
   *
   * @param filter - Property filter to apply
   * @returns This builder for chaining
   */
  where(filter: PropertyFilter): this {
    if (this.steps.length === 0) {
      throw new Error('Cannot apply where() before defining a traversal step');
    }
    this.steps[this.steps.length - 1].filter = filter;
    return this;
  }

  /**
   * Sets the maximum depth for traversal.
   * Depth means "how many hops from the start node."
   * Each hop uses the next step in the pattern; when all steps are consumed,
   * the pattern restarts from the first step (cyclic).
   *
   * @param n - Maximum number of hops
   * @returns This builder for chaining
   */
  depth(n: number): this {
    this.maxDepth = n;
    return this;
  }

  /**
   * Limits the number of results returned.
   *
   * @param n - Maximum number of nodes to return
   * @returns This builder for chaining
   */
  limit(n: number): this {
    this.maxLimit = n;
    return this;
  }

  /**
   * Ensures each node is visited at most once.
   *
   * Why: Prevents cycles in traversal and duplicate results.
   *
   * @returns This builder for chaining
   */
  unique(): this {
    this.uniqueNodes = true;
    return this;
  }

  /**
   * Returns the step to use at a given hop number.
   * Steps cycle: with steps [A, B] and hop 0→A, hop 1→B, hop 2→A, hop 3→B, ...
   */
  private getStepForHop(hop: number): TraversalStep {
    return this.steps[hop % this.steps.length];
  }

  /**
   * Returns the effective max depth.
   * If not explicitly set, defaults to the number of steps (execute the chain once).
   */
  private getEffectiveMaxDepth(): number {
    return this.maxDepth ?? this.steps.length;
  }

  /**
   * Executes the traversal and returns matching nodes.
   *
   * Why: Terminal operation that performs the actual graph walk.
   * Uses BFS to find all reachable nodes up to maxDepth hops.
   *
   * @returns Array of nodes found during traversal
   */
  async collect(): Promise<Node[]> {
    if (this.steps.length === 0) return [];

    const result: Node[] = [];
    const visited = this.uniqueNodes ? new Set<NodeId>() : null;

    const startNode = await this.graph.getNode(this.startNodeId);
    if (!startNode) return [];

    // BFS queue: node and current hop depth
    const effectiveDepth = this.getEffectiveMaxDepth();
    const queue: Array<{ node: Node; hop: number }> = [{ node: startNode, hop: 0 }];
    if (visited) visited.add(startNode.id);

    while (queue.length > 0 && result.length < this.maxLimit) {
      const current = queue.shift()!;

      // Every node except the start is a result
      if (current.hop > 0) {
        result.push(current.node);
        if (result.length >= this.maxLimit) break;
      }

      // Can we continue?
      if (current.hop >= effectiveDepth) continue;

      // Get the step for this hop
      const step = this.getStepForHop(current.hop);

      const neighbors = await this.graph.getNeighbors(
        current.node.id,
        step.relationshipTypes,
        step.direction
      );

      for (const { node } of neighbors) {
        if (step.filter && !matchesFilter(node.properties, step.filter)) {
          continue;
        }

        if (visited) {
          if (visited.has(node.id)) continue;
          visited.add(node.id);
        }

        queue.push({ node, hop: current.hop + 1 });
      }
    }

    return result;
  }

  /**
   * Executes the traversal and returns complete paths.
   *
   * Why: Sometimes you need not just the nodes, but the full path taken to reach them.
   *
   * @returns Array of paths (nodes + relationships)
   */
  async collectPaths(): Promise<Path[]> {
    if (this.steps.length === 0) return [];

    const paths: Path[] = [];
    const visited = this.uniqueNodes ? new Set<NodeId>() : null;

    const startNode = await this.graph.getNode(this.startNodeId);
    if (!startNode) return [];

    interface QueueItem {
      node: Node;
      hop: number;
      pathNodes: Node[];
      pathRels: Relationship[];
    }

    const effectiveDepth = this.getEffectiveMaxDepth();
    const queue: QueueItem[] = [
      { node: startNode, hop: 0, pathNodes: [startNode], pathRels: [] },
    ];
    if (visited) visited.add(startNode.id);

    while (queue.length > 0 && paths.length < this.maxLimit) {
      const current = queue.shift()!;

      // Record every non-start node as a path endpoint
      if (current.pathRels.length > 0) {
        paths.push({
          nodes: current.pathNodes,
          relationships: current.pathRels,
          length: current.pathRels.length,
        });
        if (paths.length >= this.maxLimit) break;
      }

      // Can we continue?
      if (current.hop >= effectiveDepth) continue;

      const step = this.getStepForHop(current.hop);

      const neighbors = await this.graph.getNeighbors(
        current.node.id,
        step.relationshipTypes,
        step.direction
      );

      for (const { node, relationship } of neighbors) {
        if (step.filter && !matchesFilter(node.properties, step.filter)) {
          continue;
        }

        if (visited) {
          if (visited.has(node.id)) continue;
          visited.add(node.id);
        }

        queue.push({
          node,
          hop: current.hop + 1,
          pathNodes: [...current.pathNodes, node],
          pathRels: [...current.pathRels, relationship],
        });
      }
    }

    return paths;
  }

  /**
   * Executes the traversal and returns a subgraph (all nodes and relationships encountered).
   *
   * Why: Useful for extracting a connected component or neighborhood for analysis.
   *
   * @returns A subgraph containing all nodes and relationships in the traversal
   */
  async collectSubgraph(): Promise<Subgraph> {
    if (this.steps.length === 0) return { nodes: [], relationships: [] };

    const nodes = new Map<NodeId, Node>();
    const relationships = new Map<string, Relationship>();

    const startNode = await this.graph.getNode(this.startNodeId);
    if (!startNode) return { nodes: [], relationships: [] };

    const effectiveDepth = this.getEffectiveMaxDepth();
    const queue: Array<{ node: Node; hop: number }> = [{ node: startNode, hop: 0 }];
    const visited = new Set<NodeId>();
    visited.add(startNode.id);
    nodes.set(startNode.id, startNode);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.hop >= effectiveDepth) continue;

      const step = this.getStepForHop(current.hop);

      const neighbors = await this.graph.getNeighbors(
        current.node.id,
        step.relationshipTypes,
        step.direction
      );

      for (const { node, relationship } of neighbors) {
        relationships.set(relationship.id, relationship);

        if (step.filter && !matchesFilter(node.properties, step.filter)) {
          continue;
        }

        if (!visited.has(node.id)) {
          visited.add(node.id);
          nodes.set(node.id, node);

          queue.push({ node, hop: current.hop + 1 });
        }
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      relationships: Array.from(relationships.values()),
    };
  }

}
