/**
 * Pure graph algorithms.
 *
 * Why: BFS and Dijkstra are pure algorithms that operate on a graph structure.
 * By taking a `getNeighbors` callback, they're decoupled from storage and
 * reusable outside the engine (testing, analysis, different adapters).
 *
 * Architecture: 90% pure functions / 10% I/O shell. This is the 90%.
 */

import type { Node, NodeId, Relationship, Path } from '../types.js';

/** The shape of a neighbor lookup function — injected by the I/O shell */
export type GetNeighborsFn = (
  nodeId: NodeId,
  relationshipTypes?: string[],
  direction?: 'outgoing' | 'incoming' | 'both'
) => Promise<Array<{ node: Node; relationship: Relationship }>>;

/** The shape of a node lookup function — injected by the I/O shell */
export type GetNodeFn = (id: NodeId) => Promise<Node | null>;

/**
 * BFS shortest path (unweighted).
 *
 * Why: Finds the shortest path by hop count between two nodes.
 * Pure algorithm — the only I/O is the injected getNeighbors callback.
 *
 * @param getNeighbors - Callback to get neighbors (injected from engine)
 * @param from - Start node
 * @param to - End node
 * @param startNode - The resolved start Node object
 * @param relationshipTypes - Optional relationship type filter
 * @param direction - Traversal direction
 * @param maxDepth - Maximum path length
 * @returns The shortest path, or null if unreachable
 */
export async function bfsShortestPath(
  getNeighbors: GetNeighborsFn,
  from: NodeId,
  to: NodeId,
  startNode: Node,
  relationshipTypes?: string[],
  direction: 'outgoing' | 'incoming' | 'both' = 'both',
  maxDepth = Infinity
): Promise<Path | null> {
  const queue: Array<{
    nodeId: NodeId;
    path: { nodes: Node[]; relationships: Relationship[] };
  }> = [];
  const visited = new Set<NodeId>();

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

    const neighbors = await getNeighbors(current.nodeId, relationshipTypes, direction);

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
 *
 * Why: Finds the lowest-cost path using a relationship property as the weight.
 * Pure algorithm — the only I/O is the injected callbacks.
 *
 * @param getNeighbors - Callback to get neighbors
 * @param getNode - Callback to get a node by ID
 * @param from - Start node ID
 * @param to - End node ID
 * @param costProperty - Relationship property to use as weight
 * @param relationshipTypes - Optional relationship type filter
 * @param direction - Traversal direction
 * @param maxDepth - Maximum cost
 * @returns The lowest-cost path, or null if unreachable
 */
export async function dijkstraShortestPath(
  getNeighbors: GetNeighborsFn,
  getNode: GetNodeFn,
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
        const node = await getNode(curr);
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

    const neighbors = await getNeighbors(current, relationshipTypes, direction);

    for (const { node, relationship } of neighbors) {
      const cost = Number(relationship.properties[costProperty] ?? 1);
      const alt = currentDist + cost;

      if (alt < (distances.get(node.id) ?? Infinity)) {
        distances.set(node.id, alt);
        previous.set(node.id, { node: (await getNode(current))!, relationship });
        unvisited.add(node.id);
      }
    }
  }

  return null;
}
