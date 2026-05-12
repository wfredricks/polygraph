/**
 * PropertyIndex tests.
 *
 * Why: confirms (a) only configured (label, property) pairs are
 * maintained, (b) `lookup` returns null for unconfigured pairs vs
 * empty for configured-but-empty, (c) updates correctly migrate node
 * ids between value cells.
 *
 * `Twin.userId` is in the configured `INDEXED_PROPERTIES`. We use it
 * here so we can exercise both the indexed and not-indexed paths
 * without polluting config with test-only entries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PropertyIndex } from '../property-index.js';
import type { NodeSlice } from '../types.js';

function slice(id: string, labels: string[], props: Record<string, unknown> = {}): NodeSlice {
  return { id, labels, properties: props };
}

describe('PropertyIndex', () => {
  let idx: PropertyIndex;

  beforeEach(() => {
    idx = new PropertyIndex();
  });

  it('starts empty', () => {
    expect(idx.size()).toBe(0);
    expect(idx.lookup('Twin', 'userId', 'alice')?.size ?? -1).toBe(0);
  });

  it('reports indexed vs unindexed (label, property) pairs', () => {
    expect(PropertyIndex.isIndexed('Twin', 'userId')).toBe(true);
    expect(PropertyIndex.isIndexed('Twin', 'banana')).toBe(false);
    expect(PropertyIndex.isIndexed('Banana', 'userId')).toBe(false);
  });

  it('lookup returns null for unindexed pairs (signal to caller to scan)', () => {
    idx.add(slice('n1', ['Twin'], { banana: 'yes' }));
    expect(idx.lookup('Twin', 'banana', 'yes')).toBeNull();
    expect(idx.lookup('Banana', 'userId', 'alice')).toBeNull();
  });

  it('indexes only declared (label, property) pairs', () => {
    idx.add(slice('n1', ['Twin'], { userId: 'alice', irrelevant: 'x' }));
    expect(idx.lookup('Twin', 'userId', 'alice')).toEqual(new Set(['n1']));
    expect(idx.lookup('Twin', 'irrelevant', 'x')).toBeNull(); // not in config
  });

  it('multiple nodes with the same value cluster correctly', () => {
    idx.add(slice('n1', ['Twin'], { userId: 'alice' }));
    idx.add(slice('n2', ['Twin'], { userId: 'alice' }));
    idx.add(slice('n3', ['Twin'], { userId: 'bob' }));
    expect(idx.lookup('Twin', 'userId', 'alice')).toEqual(new Set(['n1', 'n2']));
    expect(idx.lookup('Twin', 'userId', 'bob')).toEqual(new Set(['n3']));
  });

  it('update migrates a node id between value cells', () => {
    idx.add(slice('n1', ['Twin'], { userId: 'alice' }));
    expect(idx.lookup('Twin', 'userId', 'alice')).toEqual(new Set(['n1']));
    idx.update('Twin', 'userId', 'n1', 'alice', 'bob');
    expect(idx.lookup('Twin', 'userId', 'alice')?.size).toBe(0);
    expect(idx.lookup('Twin', 'userId', 'bob')).toEqual(new Set(['n1']));
  });

  it('update is a no-op when value is unchanged', () => {
    idx.add(slice('n1', ['Twin'], { userId: 'alice' }));
    idx.update('Twin', 'userId', 'n1', 'alice', 'alice');
    expect(idx.lookup('Twin', 'userId', 'alice')).toEqual(new Set(['n1']));
  });

  it('update on an unindexed pair is a silent no-op (not an error)', () => {
    expect(() => idx.update('Twin', 'banana', 'n1', 'old', 'new')).not.toThrow();
    expect(idx.lookup('Twin', 'banana', 'new')).toBeNull();
  });

  it('remove vacates the cell', () => {
    const n = slice('n1', ['Twin'], { userId: 'alice' });
    idx.add(n);
    idx.remove(n);
    expect(idx.lookup('Twin', 'userId', 'alice')?.size).toBe(0);
    expect(idx.size()).toBe(0);
  });

  it('non-primitive values are simply not indexed (no throw)', () => {
    idx.add(slice('n1', ['Twin'], { userId: { nested: 'object' } }));
    // The value is unindexable, so the cell for it has 0 ids.
    expect(idx.lookup('Twin', 'userId', { nested: 'object' })?.size).toBe(0);
    expect(idx.size()).toBe(0);
  });

  it('onLabelAdded indexes the node under the new label', () => {
    const n = slice('n1', ['Twin'], { userId: 'alice' });
    idx.add(n);
    // Now imagine the node gained a Persona label (Persona.userId is also indexed).
    const reLabelled: NodeSlice = { ...n, labels: ['Twin', 'Persona'] };
    idx.onLabelAdded(reLabelled, 'Persona');
    expect(idx.lookup('Persona', 'userId', 'alice')).toEqual(new Set(['n1']));
    expect(idx.lookup('Twin', 'userId', 'alice')).toEqual(new Set(['n1']));
  });

  it('onLabelRemoved drops only that label entry', () => {
    const n = slice('n1', ['Twin', 'Persona'], { userId: 'alice' });
    idx.add(n);
    idx.onLabelRemoved(n, 'Persona');
    expect(idx.lookup('Persona', 'userId', 'alice')?.size).toBe(0);
    expect(idx.lookup('Twin', 'userId', 'alice')).toEqual(new Set(['n1']));
  });

  it('clear empties everything', () => {
    idx.add(slice('n1', ['Twin'], { userId: 'alice' }));
    idx.clear();
    expect(idx.size()).toBe(0);
    expect(idx.lookup('Twin', 'userId', 'alice')?.size).toBe(0);
  });
});
