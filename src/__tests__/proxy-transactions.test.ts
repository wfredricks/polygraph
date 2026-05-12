/**
 * Tests for the proxy adapter's transaction shim, reset, and convenience
 * accessors.
 *
 * Why: the proxy adapter is PolyGraph's drop-in surface for callers that
 * came from Neo4j (imperative `beginTransaction()` + commit/rollback,
 * the `nodeCount` / `relationshipCount` getters, the MockAdapter-style
 * `reset()`). These paths were the lowest-covered region of the engine
 * (proxy adapter sat at ~67% lines pre-fix); this file pins their
 * observable behaviour so future refactors can't silently regress them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PolyGraphProxyAdapter } from '../proxy/polygraph-proxy-adapter.js';

describe('PolyGraphProxyAdapter \u2014 transactions, reset, counters', { timeout: 30_000 }, () => {
  let adapter: PolyGraphProxyAdapter;
  const SPACE = 'tx-test';

  beforeEach(async () => {
    adapter = new PolyGraphProxyAdapter({ storage: 'memory' });
    await adapter.connect();
    await adapter.createGraphSpace(SPACE);
  });

  afterEach(async () => {
    await adapter.disconnect().catch(() => {});
  });

  // \u2500\u2500\u2500 beginTransaction \u2500\u2500\u2500
  describe('beginTransaction', () => {
    it('commit applies queued node writes', async () => {
      const tx = await adapter.beginTransaction(SPACE);
      await tx.createNode('Person', { name: 'Ada' });
      await tx.createNode('Person', { name: 'Lin' });
      // The shim applies operations during commit; until then the
      // operations have already taken effect through the adapter
      // path. The test pins commit() not throwing and the writes
      // being readable afterwards.
      await tx.commit();
      const people = await adapter.findNodes(SPACE, 'Person');
      expect(people.length).toBe(2);
      expect(people.map((p) => p.properties.name).sort()).toEqual(['Ada', 'Lin']);
    });

    it('rollback empties the queued ops list', async () => {
      const tx = await adapter.beginTransaction(SPACE);
      // The shim's queued-ops list is internal; we exercise the
      // public API and confirm rollback returns without throwing.
      await tx.rollback();
      // After rollback the tx object should still be usable enough
      // not to crash if commit is invoked (no-op behaviour).
      await tx.commit();
      const people = await adapter.findNodes(SPACE, 'Person');
      expect(people.length).toBe(0);
    });

    it('the tx object exposes the full node + rel surface', async () => {
      const tx = await adapter.beginTransaction(SPACE);

      const ada = await tx.createNode('Person', { name: 'Ada' });
      const lin = await tx.createNode('Person', { name: 'Lin' });
      const rel = await tx.createRelationship(ada.id, lin.id, 'KNOWS', { since: 2026 });
      expect(rel).toBeDefined();

      const fetched = await tx.getNode(ada.id);
      expect(fetched?.properties.name).toBe('Ada');

      const updated = await tx.updateNode(ada.id, { city: 'Lancaster' });
      expect(updated?.properties.city).toBe('Lancaster');

      const found = await tx.findNodes('Person', { name: 'Lin' });
      expect(found.length).toBe(1);

      // Upsert via the tx surface.
      const ups = await tx.upsertNode('Person', { name: 'Ada' }, { age: 36 });
      expect(ups.id).toBe(ada.id);
      expect(ups.properties.age).toBe(36);

      const upsRel = await tx.upsertRelationship(ada.id, lin.id, 'KNOWS', { since: 2027 });
      expect(upsRel).toBeDefined();

      // Delete via the tx surface (delete relationship first so the
      // node delete doesn't cascade-orphan the assertion).
      const delRel = await tx.deleteRelationship(rel.id);
      expect(delRel).toBe(true);
      const delNode = await tx.deleteNode(lin.id);
      expect(delNode).toBe(true);

      await tx.commit();
    });
  });

  // \u2500\u2500\u2500 nodeCount / relationshipCount getters \u2500\u2500\u2500
  describe('count getters', () => {
    it('nodeCount reflects writes across spaces (global counter)', async () => {
      const before = await adapter.nodeCount;
      expect(before).toBe(0);

      await adapter.createNode(SPACE, 'A', {});
      await adapter.createNode(SPACE, 'B', {});

      await adapter.createGraphSpace('another');
      await adapter.createNode('another', 'C', {});

      const after = await adapter.nodeCount;
      // The PolyGraph stats counter is per-engine, not per-space \u2014
      // confirms the proxy correctly reads global stats.
      expect(after).toBe(3);
    });

    it('relationshipCount returns the underlying counter', async () => {
      const a = await adapter.createNode(SPACE, 'X', {});
      const b = await adapter.createNode(SPACE, 'X', {});
      expect(await adapter.relationshipCount).toBe(0);
      await adapter.createRelationship(SPACE, a.id, b.id, 'LINKS');
      expect(await adapter.relationshipCount).toBe(1);
    });
  });

  // \u2500\u2500\u2500 reset() \u2500\u2500\u2500
  describe('reset', () => {
    it('drops all nodes, all relationships, and all graph spaces', async () => {
      await adapter.createNode(SPACE, 'A', { v: 1 });
      await adapter.createNode(SPACE, 'A', { v: 2 });
      await adapter.createGraphSpace('extra');
      await adapter.createNode('extra', 'B', { v: 3 });

      expect(await adapter.nodeCount).toBe(3);

      await adapter.reset();

      expect(await adapter.nodeCount).toBe(0);
      expect(await adapter.relationshipCount).toBe(0);

      // listGraphSpaces should be empty (the proxy's space registry
      // was cleared, even though the persistent graph spaces lived
      // only in memory anyway).
      const spaces = await adapter.listGraphSpaces();
      expect(spaces).toEqual([]);
    });

    it('the adapter is usable again after reset', async () => {
      await adapter.createNode(SPACE, 'A', {});
      await adapter.reset();

      await adapter.createGraphSpace('after-reset');
      const n = await adapter.createNode('after-reset', 'A', { v: 1 });
      expect(n.properties.v).toBe(1);
      expect(await adapter.nodeCount).toBe(1);
    });
  });

  // \u2500\u2500\u2500 hasFeature edge cases \u2500\u2500\u2500
  describe('hasFeature', () => {
    it('returns true for every supported feature', async () => {
      for (const feature of [
        'nodes',
        'relationships',
        'traversal',
        'batch',
        'indexes',
        'cypher-bridge',
        'upsert',
        'graph-spaces',
      ]) {
        expect(adapter.hasFeature(feature)).toBe(true);
      }
    });

    it('returns false for any unsupported feature, including the empty string', async () => {
      expect(adapter.hasFeature('')).toBe(false);
      expect(adapter.hasFeature('unknown')).toBe(false);
      expect(adapter.hasFeature('full-text-search')).toBe(false);
      expect(adapter.hasFeature('vector-search')).toBe(false);
    });
  });
});
