/**
 * Adjacency index — typed neighbor lookups in O(out-degree).
 *
 * Why: `getNeighbors(nodeId, ['BOUND_TO'], 'outgoing')` today does an
 * adapter scan with prefix `n:{id}:o:BOUND_TO:` — same whole-key-space
 * sort as every other scan. For a node with five out-edges, that's
 * still O(K log K) where K is the total adapter keyset. Holding a
 * per-node `Map<EdgeType, Set<RelId>>` for each direction makes the
 * lookup O(matches).
 *
 * Storage shape:
 *
 *   nodeId -> {
 *     out: Map<edgeType, Set<RelId>>,
 *     in:  Map<edgeType, Set<RelId>>,
 *   }
 *
 * Memory cost is bounded by total edges × 2 (each edge appears once in
 * the source's `out` and once in the destination's `in`).
 *
 * @tier polygraph
 * @capability indexes.adjacency
 */

import type { NodeId, RelId } from '../types.js';
import type { AdjacencyBucket, ReadableIndex, RelSlice } from './types.js';

export class AdjacencyIndex implements ReadableIndex {
  private byNode: Map<NodeId, AdjacencyBucket> = new Map();

  size(): number {
    return this.byNode.size;
  }

  /**
   * Make sure both endpoints have a bucket. Called from PolyGraph on
   * node creation so a node with zero edges still answers correctly
   * (and avoids a write on every first edge — small win, but cleaner).
   */
  ensureNode(nodeId: NodeId): void {
    if (!this.byNode.has(nodeId)) {
      this.byNode.set(nodeId, { out: new Map(), in: new Map() });
    }
  }

  /** Remove all adjacency for a node. Called on node deletion. */
  forgetNode(nodeId: NodeId): void {
    this.byNode.delete(nodeId);
  }

  /** Register an edge in both endpoints' adjacency buckets. */
  addEdge(rel: RelSlice): void {
    this.add(rel.startNode, 'out', rel.type, rel.id);
    this.add(rel.endNode, 'in', rel.type, rel.id);
  }

  /** Remove an edge from both endpoints. */
  removeEdge(rel: RelSlice): void {
    this.del(rel.startNode, 'out', rel.type, rel.id);
    this.del(rel.endNode, 'in', rel.type, rel.id);
  }

  /**
   * All relationship ids leaving / entering `nodeId` of type `edgeType`.
   *
   * Returns the underlying Set — callers must snapshot if they may
   * mutate the graph mid-iteration.
   */
  lookup(nodeId: NodeId, edgeType: string, direction: 'outgoing' | 'incoming'): ReadonlySet<RelId> {
    const bucket = this.byNode.get(nodeId);
    if (!bucket) return EMPTY;
    const map = direction === 'outgoing' ? bucket.out : bucket.in;
    return map.get(edgeType) ?? EMPTY;
  }

  /**
   * All relationship ids for a node in a given direction, regardless of type.
   * Used when callers pass no `edgeType` filter.
   */
  lookupAll(nodeId: NodeId, direction: 'outgoing' | 'incoming'): IterableIterator<RelId> {
    const bucket = this.byNode.get(nodeId);
    if (!bucket) return emptyIter<RelId>();
    const map = direction === 'outgoing' ? bucket.out : bucket.in;
    return flatten(map);
  }

  /** Distinct edge types touching this node in this direction. */
  edgeTypes(nodeId: NodeId, direction: 'outgoing' | 'incoming'): IterableIterator<string> {
    const bucket = this.byNode.get(nodeId);
    if (!bucket) return emptyIter<string>();
    return (direction === 'outgoing' ? bucket.out : bucket.in).keys();
  }

  /** Drop all entries. Used by rebuild. */
  clear(): void {
    this.byNode.clear();
  }

  // ─── Private ────────────────────────────────────────────────────

  private add(nodeId: NodeId, dir: 'out' | 'in', type: string, relId: RelId): void {
    let bucket = this.byNode.get(nodeId);
    if (!bucket) {
      bucket = { out: new Map(), in: new Map() };
      this.byNode.set(nodeId, bucket);
    }
    const map = dir === 'out' ? bucket.out : bucket.in;
    let set = map.get(type);
    if (!set) {
      set = new Set();
      map.set(type, set);
    }
    set.add(relId);
  }

  private del(nodeId: NodeId, dir: 'out' | 'in', type: string, relId: RelId): void {
    const bucket = this.byNode.get(nodeId);
    if (!bucket) return;
    const map = dir === 'out' ? bucket.out : bucket.in;
    const set = map.get(type);
    if (!set) return;
    set.delete(relId);
    if (set.size === 0) map.delete(type);
  }
}

const EMPTY: ReadonlySet<RelId> = new Set();

function* emptyIter<T>(): IterableIterator<T> {
  // no yields — fresh exhausted iterator on every call
}

function* flatten<T>(m: Map<string, Set<T>>): IterableIterator<T> {
  for (const set of m.values()) {
    for (const v of set) yield v;
  }
}
