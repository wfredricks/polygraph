/**
 * Shared types for the in-memory index module.
 *
 * Why: The indexes are derived state — they reflect what's in the
 * node and relationship stores but live entirely in JS memory and are
 * rebuilt on `PolyGraph.open()`. These types keep the surface area
 * small and prevent stringly-typed sprawl.
 *
 * @tier polygraph
 * @capability indexes.types
 */

import type { Node, NodeId, Relationship, RelId } from '../types.js';

/** A property value that an index will key on. We only index primitives. */
export type IndexablePrimitive = string | number | boolean;

/** Direction-aware bucket for adjacency lookups. */
export interface AdjacencyBucket {
  /** Relationship ids leaving this node, grouped by edge type. */
  out: Map<string, Set<RelId>>;
  /** Relationship ids entering this node, grouped by edge type. */
  in: Map<string, Set<RelId>>;
}

/** Minimal slice of a node we need when (re)building indexes. */
export interface NodeSlice {
  id: NodeId;
  labels: readonly string[];
  properties: Readonly<Record<string, unknown>>;
}

/** Minimal slice of a relationship we need when (re)building indexes. */
export interface RelSlice {
  id: RelId;
  type: string;
  startNode: NodeId;
  endNode: NodeId;
}

/** Public read surface every index exposes. */
export interface ReadableIndex {
  size(): number;
}

/** Make a value indexable, or return null if we should skip it. */
export function toIndexable(value: unknown): IndexablePrimitive | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

/** Type guard for Node used when widening from storage. */
export function asNodeSlice(n: Node): NodeSlice {
  return { id: n.id, labels: n.labels, properties: n.properties };
}

/** Type guard for Relationship used when widening from storage. */
export function asRelSlice(r: Relationship): RelSlice {
  return { id: r.id, type: r.type, startNode: r.startNode, endNode: r.endNode };
}
