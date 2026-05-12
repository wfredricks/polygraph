/**
 * CompositeIndex tests.
 *
 * Why: (Twin, userId) is the canonical configured composite. We pin
 * the null-vs-empty contract, the update migration semantics, and the
 * label add/remove hooks. (Multi-property composites aren't in config
 * today; the impl supports them and we add a small structural test
 * via the config helpers without registering a new composite.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CompositeIndex } from '../composite-index.js';
import type { NodeSlice } from '../types.js';

function slice(id: string, labels: string[], props: Record<string, unknown> = {}): NodeSlice {
  return { id, labels, properties: props };
}

describe('CompositeIndex', () => {
  let idx: CompositeIndex;

  beforeEach(() => {
    idx = new CompositeIndex();
  });

  it('starts empty', () => {
    expect(idx.size()).toBe(0);
    expect(idx.lookup('Twin', ['userId'], ['alice'])?.size).toBe(0);
  });

  it('reports indexed vs unindexed (label, properties) tuples', () => {
    expect(CompositeIndex.isIndexed('Twin', ['userId'])).toBe(true);
    expect(CompositeIndex.isIndexed('Document', ['userId'])).toBe(true);
    expect(CompositeIndex.isIndexed('Twin', ['twinType'])).toBe(false); // not a composite, only single-prop index
    expect(CompositeIndex.isIndexed('Banana', ['userId'])).toBe(false);
  });

  it('lookup returns null for unindexed tuples', () => {
    expect(idx.lookup('Twin', ['nope'], ['x'])).toBeNull();
    expect(idx.lookup('Banana', ['userId'], ['alice'])).toBeNull();
  });

  it('add buckets nodes by composite key', () => {
    idx.add(slice('n1', ['Twin'], { userId: 'alice' }));
    idx.add(slice('n2', ['Twin'], { userId: 'alice' }));
    idx.add(slice('n3', ['Twin'], { userId: 'bob' }));
    expect(idx.lookup('Twin', ['userId'], ['alice'])).toEqual(new Set(['n1', 'n2']));
    expect(idx.lookup('Twin', ['userId'], ['bob'])).toEqual(new Set(['n3']));
  });

  it('nodes with missing composite property are not indexed', () => {
    idx.add(slice('n1', ['Twin'], { name: 'no userId here' }));
    expect(idx.size()).toBe(0);
  });

  it('nodes whose composite property is a non-primitive are not indexed', () => {
    idx.add(slice('n1', ['Twin'], { userId: { nested: 1 } }));
    expect(idx.size()).toBe(0);
  });

  it('update migrates a node id when its composite value changes', () => {
    const before = slice('n1', ['Twin'], { userId: 'alice' });
    idx.add(before);
    const after = slice('n1', ['Twin'], { userId: 'bob' });
    idx.update('Twin', before, after);
    expect(idx.lookup('Twin', ['userId'], ['alice'])?.size).toBe(0);
    expect(idx.lookup('Twin', ['userId'], ['bob'])).toEqual(new Set(['n1']));
  });

  it('update is a no-op when composite value is unchanged', () => {
    const n = slice('n1', ['Twin'], { userId: 'alice' });
    idx.add(n);
    idx.update('Twin', n, n);
    expect(idx.lookup('Twin', ['userId'], ['alice'])).toEqual(new Set(['n1']));
  });

  it('remove vacates the cell', () => {
    const n = slice('n1', ['Twin'], { userId: 'alice' });
    idx.add(n);
    idx.remove(n);
    expect(idx.lookup('Twin', ['userId'], ['alice'])?.size).toBe(0);
    expect(idx.size()).toBe(0);
  });

  it('onLabelAdded indexes under the new label', () => {
    const n = slice('n1', [], { userId: 'alice' });
    // Without the Twin label, nothing is indexed yet.
    idx.add(n);
    expect(idx.size()).toBe(0);

    const reLabelled: NodeSlice = { ...n, labels: ['Twin'] };
    idx.onLabelAdded(reLabelled, 'Twin');
    expect(idx.lookup('Twin', ['userId'], ['alice'])).toEqual(new Set(['n1']));
  });

  it('onLabelRemoved drops that label\'s composite entry only', () => {
    // n1 is both a Twin and a Document with userId=alice; both composites apply.
    const n = slice('n1', ['Twin', 'Document'], { userId: 'alice' });
    idx.add(n);
    expect(idx.lookup('Twin', ['userId'], ['alice'])).toEqual(new Set(['n1']));
    expect(idx.lookup('Document', ['userId'], ['alice'])).toEqual(new Set(['n1']));

    idx.onLabelRemoved(n, 'Document');
    expect(idx.lookup('Twin', ['userId'], ['alice'])).toEqual(new Set(['n1']));
    expect(idx.lookup('Document', ['userId'], ['alice'])?.size).toBe(0);
  });

  it('lookup with mismatched value-count returns null', () => {
    expect(idx.lookup('Twin', ['userId'], [])).toBeNull();
    expect(idx.lookup('Twin', ['userId'], ['alice', 'bob'])).toBeNull();
  });

  it('clear empties everything', () => {
    idx.add(slice('n1', ['Twin'], { userId: 'alice' }));
    idx.clear();
    expect(idx.size()).toBe(0);
    expect(idx.lookup('Twin', ['userId'], ['alice'])?.size).toBe(0);
  });

  it('configured returns the declared composites', () => {
    const configured = idx.configured();
    expect(configured.some((s) => s.label === 'Twin' && s.properties[0] === 'userId')).toBe(true);
  });
});
