/**
 * LabelIndex tests.
 *
 * Why: pins the public read shape (`lookup(label)` returns a
 * `ReadonlySet<NodeId>`, including the empty-set case) and the
 * lifecycle invariants for add / remove / addLabel / removeLabel.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LabelIndex } from '../label-index.js';
import type { NodeSlice } from '../types.js';

function slice(id: string, labels: string[], props: Record<string, unknown> = {}): NodeSlice {
  return { id, labels, properties: props };
}

describe('LabelIndex', () => {
  let idx: LabelIndex;

  beforeEach(() => {
    idx = new LabelIndex();
  });

  it('starts empty', () => {
    expect(idx.size()).toBe(0);
    expect(idx.nodeCount()).toBe(0);
    expect(idx.lookup('Twin').size).toBe(0);
  });

  it('indexes a node under all of its labels', () => {
    idx.add(slice('n1', ['Twin', 'Persona']));
    expect(idx.lookup('Twin')).toEqual(new Set(['n1']));
    expect(idx.lookup('Persona')).toEqual(new Set(['n1']));
    expect(idx.nodeCount()).toBe(1);
  });

  it('returns the same empty Set for any unknown label', () => {
    expect(idx.lookup('Nope').size).toBe(0);
  });

  it('add is idempotent', () => {
    const n = slice('n1', ['Twin']);
    idx.add(n);
    idx.add(n);
    expect(idx.lookup('Twin').size).toBe(1);
    expect(idx.nodeCount()).toBe(1);
  });

  it('remove drops all label entries for the node', () => {
    idx.add(slice('n1', ['Twin', 'Persona']));
    idx.add(slice('n2', ['Twin']));

    idx.remove('n1', ['Twin', 'Persona']);
    expect(idx.lookup('Twin')).toEqual(new Set(['n2']));
    expect(idx.lookup('Persona').size).toBe(0);
    expect(idx.nodeCount()).toBe(1);
  });

  it('empty label bucket is reclaimed (size drops)', () => {
    idx.add(slice('n1', ['Persona']));
    expect(idx.size()).toBe(1);
    idx.remove('n1', ['Persona']);
    expect(idx.size()).toBe(0);
  });

  it('addLabel adds a node to a new label without disturbing the others', () => {
    idx.add(slice('n1', ['Twin']));
    idx.addLabel('n1', 'Persona');
    expect(idx.lookup('Twin')).toEqual(new Set(['n1']));
    expect(idx.lookup('Persona')).toEqual(new Set(['n1']));
  });

  it('removeLabel removes only that label', () => {
    idx.add(slice('n1', ['Twin', 'Persona']));
    idx.removeLabel('n1', 'Twin');
    expect(idx.lookup('Twin').size).toBe(0);
    expect(idx.lookup('Persona')).toEqual(new Set(['n1']));
  });

  it('allNodeIds is the union across labels and is deduped', () => {
    idx.add(slice('n1', ['Twin', 'Persona']));
    idx.add(slice('n2', ['Document']));
    expect(new Set(idx.allNodeIds())).toEqual(new Set(['n1', 'n2']));
  });

  it('clear empties everything', () => {
    idx.add(slice('n1', ['Twin']));
    idx.add(slice('n2', ['Document']));
    idx.clear();
    expect(idx.size()).toBe(0);
    expect(idx.nodeCount()).toBe(0);
    expect(idx.lookup('Twin').size).toBe(0);
  });

  it('a node with zero labels still appears in nodeCount but no buckets', () => {
    idx.add(slice('orphan', []));
    expect(idx.nodeCount()).toBe(1);
    expect(idx.size()).toBe(0);
  });
});
