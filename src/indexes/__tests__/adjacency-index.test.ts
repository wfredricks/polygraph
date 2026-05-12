/**
 * AdjacencyIndex tests.
 *
 * Why: pins the typed-neighbor read shape (`lookup(nodeId, type, dir)`
 * returns the right Set), the directionality (out/in are independent),
 * the deduplication after multi-add, and the `lookupAll` fallback that
 * the engine uses when a caller doesn't filter by type.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AdjacencyIndex } from '../adjacency-index.js';
import type { RelSlice } from '../types.js';

function rel(id: string, type: string, from: string, to: string): RelSlice {
  return { id, type, startNode: from, endNode: to };
}

describe('AdjacencyIndex', () => {
  let idx: AdjacencyIndex;

  beforeEach(() => {
    idx = new AdjacencyIndex();
  });

  it('starts empty', () => {
    expect(idx.size()).toBe(0);
    expect(idx.lookup('n1', 'BOUND_TO', 'outgoing').size).toBe(0);
    expect(idx.lookup('n1', 'BOUND_TO', 'incoming').size).toBe(0);
  });

  it('ensureNode creates an empty bucket without producing edges', () => {
    idx.ensureNode('n1');
    expect(idx.size()).toBe(1);
    expect(idx.lookup('n1', 'BOUND_TO', 'outgoing').size).toBe(0);
  });

  it('addEdge populates both endpoints', () => {
    idx.addEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    expect(idx.lookup('n1', 'BOUND_TO', 'outgoing')).toEqual(new Set(['e1']));
    expect(idx.lookup('n2', 'BOUND_TO', 'incoming')).toEqual(new Set(['e1']));
    expect(idx.lookup('n1', 'BOUND_TO', 'incoming').size).toBe(0);
    expect(idx.lookup('n2', 'BOUND_TO', 'outgoing').size).toBe(0);
  });

  it('groups multiple edges of the same type', () => {
    idx.addEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    idx.addEdge(rel('e2', 'BOUND_TO', 'n1', 'n3'));
    idx.addEdge(rel('e3', 'BOUND_TO', 'n1', 'n4'));
    expect(idx.lookup('n1', 'BOUND_TO', 'outgoing')).toEqual(new Set(['e1', 'e2', 'e3']));
  });

  it('separates edges of different types', () => {
    idx.addEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    idx.addEdge(rel('e2', 'OWNS',     'n1', 'n3'));
    expect(idx.lookup('n1', 'BOUND_TO', 'outgoing')).toEqual(new Set(['e1']));
    expect(idx.lookup('n1', 'OWNS',     'outgoing')).toEqual(new Set(['e2']));
  });

  it('removeEdge cleans up both endpoints', () => {
    idx.addEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    idx.removeEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    expect(idx.lookup('n1', 'BOUND_TO', 'outgoing').size).toBe(0);
    expect(idx.lookup('n2', 'BOUND_TO', 'incoming').size).toBe(0);
  });

  it('forgetNode drops the node from the index entirely', () => {
    idx.addEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    idx.forgetNode('n1');
    expect(idx.lookup('n1', 'BOUND_TO', 'outgoing').size).toBe(0);
    // The other endpoint still exists; its incoming side still references e1
    // (the engine will call removeEdge separately as part of cascading).
    expect(idx.lookup('n2', 'BOUND_TO', 'incoming')).toEqual(new Set(['e1']));
  });

  it('lookupAll iterates every type for a node and is fresh on each call', () => {
    idx.addEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    idx.addEdge(rel('e2', 'OWNS',     'n1', 'n3'));

    const first = Array.from(idx.lookupAll('n1', 'outgoing')).sort();
    const second = Array.from(idx.lookupAll('n1', 'outgoing')).sort();
    expect(first).toEqual(['e1', 'e2']);
    expect(second).toEqual(['e1', 'e2']); // not a one-shot iterator
  });

  it('lookupAll on an unknown node yields an empty (fresh) iterator', () => {
    const a = Array.from(idx.lookupAll('ghost', 'outgoing'));
    const b = Array.from(idx.lookupAll('ghost', 'outgoing'));
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });

  it('edgeTypes enumerates the types touching a node', () => {
    idx.addEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    idx.addEdge(rel('e2', 'OWNS',     'n1', 'n3'));
    expect(new Set(idx.edgeTypes('n1', 'outgoing'))).toEqual(new Set(['BOUND_TO', 'OWNS']));
  });

  it('clear empties everything', () => {
    idx.addEdge(rel('e1', 'BOUND_TO', 'n1', 'n2'));
    idx.clear();
    expect(idx.size()).toBe(0);
    expect(idx.lookup('n1', 'BOUND_TO', 'outgoing').size).toBe(0);
  });

  it('self-loops are correctly recorded in both directions', () => {
    idx.addEdge(rel('e1', 'KNOWS', 'n1', 'n1'));
    expect(idx.lookup('n1', 'KNOWS', 'outgoing')).toEqual(new Set(['e1']));
    expect(idx.lookup('n1', 'KNOWS', 'incoming')).toEqual(new Set(['e1']));
  });
});
