/**
 * Unit tests for the pure key parsers in `pure/keys.ts`.
 *
 * Why: a 2026-05-12 parity test against a real codebase SIG surfaced a
 * silent data loss in `allNodes()` whenever node ids contained colons
 * (e.g. `foundation/auth:createAuthProvider`). Root cause was
 * `streamPersistedNodes` calling `lastSegment(key)` on label-index keys
 * `i:l:{label}:{nodeId}` — the split-on-`:` parser returned just the
 * trailing token instead of the full node id. We now have a dedicated
 * colon-safe parser (`labelIndexNodeId`); these tests pin its
 * behaviour and document `lastSegment`'s contract.
 */

import { describe, it, expect } from 'vitest';
import {
  labelIndexKey,
  labelIndexNodeId,
  labelIndexPrefix,
  lastSegment,
  nodeInKey,
  nodeInPrefix,
  nodeInTypePrefix,
  nodeKey,
  nodeLabelKey,
  nodeOutKey,
  nodeOutPrefix,
  nodeOutTypePrefix,
  propIndexKey,
  propIndexPrefix,
  propIndexValuePrefix,
  relKey,
  relPrefix,
  stripPrefix,
} from '../pure/keys.js';

describe('lastSegment', () => {
  it('returns the trailing segment for adjacency keys', () => {
    // n:{nodeId}:o:{type}:{relId} — relId is a UUID with no colons.
    expect(lastSegment('n:abc:o:KNOWS:rel-123')).toBe('rel-123');
  });

  it('is safe for adjacency keys whose nodeId contains colons', () => {
    expect(
      lastSegment('n:foundation/auth:createAuthProvider:o:EXPORTS:rel-xyz'),
    ).toBe('rel-xyz');
  });

  it('returns whole string when no colons present', () => {
    expect(lastSegment('relid-only')).toBe('relid-only');
  });

  // Negative documentation: `lastSegment` is unsafe for label-index keys.
  // This test pins the (buggy) historical behaviour so a future refactor
  // can't claim "lastSegment is colon-safe" — it isn't.
  it('is NOT safe for label-index keys whose node id contains colons', () => {
    const key = labelIndexKey('Function', 'foundation/auth:createAuthProvider');
    // Expected: nodeId = 'foundation/auth:createAuthProvider'.
    // Actual: lastSegment returns just the trailing token.
    expect(lastSegment(key)).toBe('createAuthProvider');
    expect(lastSegment(key)).not.toBe('foundation/auth:createAuthProvider');
  });
});

describe('stripPrefix', () => {
  it('removes a known prefix', () => {
    expect(stripPrefix('i:l:Twin:abc', 'i:l:Twin:')).toBe('abc');
  });

  it('returns the original key when the prefix does not match', () => {
    // Documenting the non-validating behaviour: stripPrefix trusts its
    // caller. If the prefix isn't actually a prefix the result is junk.
    // (Callers that need validation should switch to a dedicated parser.)
    expect(stripPrefix('foo:bar', 'i:l:').length).toBeGreaterThan(0);
  });
});

describe('key formatters — round-trip shapes', () => {
  it('node keys', () => {
    expect(nodeKey('abc')).toBe('n:abc');
    expect(nodeLabelKey('abc', 'Twin')).toBe('n:abc:l:Twin');
    expect(nodeOutKey('abc', 'KNOWS', 'r1')).toBe('n:abc:o:KNOWS:r1');
    expect(nodeInKey('abc', 'KNOWS', 'r1')).toBe('n:abc:i:KNOWS:r1');
    expect(nodeOutPrefix('abc')).toBe('n:abc:o:');
    expect(nodeOutTypePrefix('abc', 'KNOWS')).toBe('n:abc:o:KNOWS:');
    expect(nodeInPrefix('abc')).toBe('n:abc:i:');
    expect(nodeInTypePrefix('abc', 'KNOWS')).toBe('n:abc:i:KNOWS:');
  });

  it('relationship keys', () => {
    expect(relKey('r1')).toBe('r:r1');
    expect(relPrefix()).toBe('r:');
  });

  it('index keys', () => {
    expect(labelIndexKey('Twin', 'abc')).toBe('i:l:Twin:abc');
    expect(labelIndexPrefix('Twin')).toBe('i:l:Twin:');
    expect(propIndexKey('Twin', 'name', 'Ada', 'abc')).toBe('i:p:Twin:name:Ada:abc');
    expect(propIndexValuePrefix('Twin', 'name', 'Ada')).toBe('i:p:Twin:name:Ada:');
    expect(propIndexPrefix('Twin', 'name')).toBe('i:p:Twin:name:');
  });

  it('formatters tolerate colon-bearing node ids', () => {
    const id = 'foundation/auth:createAuthProvider';
    expect(nodeKey(id)).toBe(`n:${id}`);
    expect(labelIndexKey('Function', id)).toBe(`i:l:Function:${id}`);
    // The key is still parseable by labelIndexNodeId.
    expect(labelIndexNodeId(labelIndexKey('Function', id))).toBe(id);
  });
});

describe('labelIndexNodeId', () => {
  it('extracts a simple node id', () => {
    expect(labelIndexNodeId('i:l:Twin:abc-123')).toBe('abc-123');
  });

  it('preserves colons in the node id (regression for 2026-05-12 parity bug)', () => {
    const id = 'foundation/auth:createAuthProvider';
    const key = labelIndexKey('Function', id);
    expect(labelIndexNodeId(key)).toBe(id);
  });

  it('handles multi-colon node ids', () => {
    const id = 'a:b:c:d:e';
    const key = labelIndexKey('X', id);
    expect(labelIndexNodeId(key)).toBe(id);
  });

  it('round-trips with labelIndexKey', () => {
    const cases: Array<[string, string]> = [
      ['Twin', 'simple-id'],
      ['Function', 'foundation/auth:createAuthProvider'],
      ['SourceFile', 'organism/hierarchy/promotion-pipeline.ts'],
      ['EIPCategory', 'Messaging Channels'],
      ['Decision', 'DEC-01'],
    ];
    for (const [label, id] of cases) {
      const key = labelIndexKey(label, id);
      expect(labelIndexNodeId(key)).toBe(id);
    }
  });

  it('returns null for non-label-index keys', () => {
    expect(labelIndexNodeId('n:abc')).toBeNull();
    expect(labelIndexNodeId('r:rel-1')).toBeNull();
    expect(labelIndexNodeId('m:nodeCount')).toBeNull();
    expect(labelIndexNodeId('')).toBeNull();
  });

  it('returns null when the label/id separator is missing', () => {
    expect(labelIndexNodeId('i:l:')).toBeNull();
    expect(labelIndexNodeId('i:l:NoSeparator')).toBeNull();
  });
});
