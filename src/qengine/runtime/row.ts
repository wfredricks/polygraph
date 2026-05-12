/**
 * qengine runtime — Row and GraphValue.
 *
 * Why: Every executor stage hands the next stage a `Row` — a flat
 * variable->value map. Keeping that shape independent of PolyGraph's
 * internal `Node` type means projections, future joins, and future
 * expression evaluation all speak the same currency. The discriminated
 * `NodeValue`/`EdgeValue` union is what makes `r.n.kind === 'node'`
 * testable in user code (see slice.test.ts).
 *
 * @tier polygraph
 * @capability qengine.runtime
 * @style pure
 */

import type { Node, Relationship } from '../../types.js';

/** A graph node as seen by query consumers. */
export interface NodeValue {
  kind: 'node';
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

/**
 * A graph edge as seen by query consumers.
 *
 * Why: Reserved for v0+1, when single-hop traversal lands. Defining it
 * now keeps `GraphValue` shape stable across versions so executor
 * code can pattern-match exhaustively from day one.
 */
export interface EdgeValue {
  kind: 'edge';
  id: string;
  type: string;
  startNode: string;
  endNode: string;
  properties: Record<string, unknown>;
}

export type GraphValue =
  | NodeValue
  | EdgeValue
  | string
  | number
  | boolean
  | null;

export type Row = Record<string, GraphValue>;

/** Adapter: PolyGraph `Node` -> public `NodeValue`. Pure. */
export function nodeToValue(node: Node): NodeValue {
  return {
    kind: 'node',
    id: node.id,
    labels: [...node.labels],
    properties: { ...node.properties },
  };
}

/** Adapter: PolyGraph `Relationship` -> public `EdgeValue`. Pure. */
export function edgeToValue(rel: Relationship): EdgeValue {
  return {
    kind: 'edge',
    id: rel.id,
    type: rel.type,
    startNode: rel.startNode,
    endNode: rel.endNode,
    properties: { ...rel.properties },
  };
}
