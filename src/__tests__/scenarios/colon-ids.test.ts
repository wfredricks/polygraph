/**
 * Scenario: node ids that contain colons (and other punctuation).
 *
 * Why: real-world graphs use structured ids \u2014 the constellation SIG uses
 * `module/file:symbol` (e.g. `foundation/auth:createAuthProvider`),
 * Neo4j elementIds look like `4:uuid:offset`, knowledge-graph systems
 * use URIs like `http://example.org/Foo#bar`. PolyGraph's storage
 * layer is colon-delimited internally; the 2026-05-12 parity test
 * surfaced a silent data loss in `allNodes()` when ids contained `:`
 * because `streamPersistedNodes` extracted the node id with a
 * split-on-`:`. The fix introduced `labelIndexNodeId` \u2014 these tests
 * pin colon-safety across every read path.
 *
 * Coverage shape: create with the unusual id, exercise every read
 * that might re-derive the id from a stored key, then close+reopen
 * and re-exercise (rehydration is where the original bug lived).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, freshGraph, ids, reopen, type Scratch } from './_helpers.js';

describe('Scenario: structured / punctuated node ids', { timeout: 30_000 }, () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.map(cleanup));
    cleanups.length = 0;
  });

  async function setup(): Promise<Scratch> {
    const s = await freshGraph();
    cleanups.push(s.dbPath);
    return s;
  }

  it('round-trips a single colon-bearing id through getNode / findNodes / allNodes', async () => {
    const { graph } = await setup();
    const id = 'foundation/auth:createAuthProvider';

    await graph.createNode(['Function'], { id, name: 'createAuthProvider' }, id);

    const direct = await graph.getNode(id);
    expect(direct?.id).toBe(id);

    const byLabel = await graph.findNodes('Function');
    expect(byLabel.map((n) => n.id)).toEqual([id]);

    const all = await graph.allNodes();
    expect(all.map((n) => n.id)).toEqual([id]);

    await graph.close();
  });

  it('preserves a representative set of constellation-style ids across reopen', async () => {
    const { graph, dbPath } = await setup();

    // A representative cross-section of id shapes we see in production:
    // - module/file:symbol  (the dominant SIG shape)
    // - file path with slashes and dotted extension
    // - bare alpha id (control)
    // - id ending in a digit (control)
    // - id with multiple colons (e.g. an elementId-style string)
    // - id with whitespace (Neo4j allows it; defensive)
    // - id whose label could overlap textually (Function name = "Function")
    const corpus: Array<[string[], string]> = [
      [['Function'], 'foundation/auth:createAuthProvider'],
      [['Function'], 'organism/continuity:getOperationModule'],
      [['Class'], 'foundation/auth:BypassProvider'],
      [['Interface'], 'foundation/events:EventBus'],
      [['SourceFile'], 'organism/hierarchy/promotion-pipeline.ts'],
      [['Sprint'], 'sprint-04'],
      [['NISTControl'], 'AC-2'],
      [['Marker'], '4:c32f8578-8d35-4096-aa29-7df91c10d98d:2072'],
      [['Marker'], 'with spaces in id'],
      [['Function'], 'Function'], // id collides textually with label name
    ];

    for (const [labels, id] of corpus) {
      await graph.createNode(labels, { id }, id);
    }

    const expected = corpus.map(([, id]) => id).sort();

    // Pre-close sanity (in-memory index).
    expect(ids(await graph.allNodes())).toEqual(expected);

    await graph.close();

    // Reopen \u2014 forces rebuildIndexes() to walk label-index keys and
    // re-derive node ids. This is the path the 2026-05-12 bug lived
    // on; with the fix in place, every id round-trips.
    const reopened = await reopen(dbPath);
    try {
      expect(ids(await reopened.allNodes())).toEqual(expected);

      // Per-label findNodes also has to survive rehydration.
      for (const [labels, id] of corpus) {
        const fn = await reopened.findNodes(labels[0]);
        expect(
          fn.some((n) => n.id === id),
          `findNodes(${labels[0]}) lost id ${id}`,
        ).toBe(true);
      }

      // And every id is still individually retrievable.
      for (const [, id] of corpus) {
        const n = await reopened.getNode(id);
        expect(n, `getNode after reopen: ${id}`).not.toBeNull();
        expect(n!.id).toBe(id);
      }

      const stats = await reopened.stats();
      expect(stats.nodeCount).toBe(corpus.length);
    } finally {
      await reopened.close();
    }
  });

  it('handles relationships whose endpoints have colon-bearing ids', async () => {
    const { graph, dbPath } = await setup();

    const src = 'organism/hierarchy/promotion-pipeline.ts';
    const dst = 'foundation/auth:createAuthProvider';

    await graph.createNode(['SourceFile'], { id: src }, src);
    await graph.createNode(['Function'], { id: dst }, dst);
    await graph.createRelationship(src, dst, 'EXPORTS', { weight: 1 });

    // Pre-close: outgoing neighbor traversal.
    const out = await graph.getNeighbors(src, ['EXPORTS'], 'outgoing');
    expect(out.map((nr) => nr.node.id)).toEqual([dst]);

    await graph.close();

    // Reopen \u2014 the adjacency index has to be rebuilt from persisted
    // adjacency markers under `n:{nodeId}:o:{type}:{relId}`. The nodeId
    // contains slashes; this exercises the relationship-walk path too.
    const reopened = await reopen(dbPath);
    try {
      const out2 = await reopened.getNeighbors(src, ['EXPORTS'], 'outgoing');
      expect(out2.map((nr) => nr.node.id)).toEqual([dst]);

      const in2 = await reopened.getNeighbors(dst, ['EXPORTS'], 'incoming');
      expect(in2.map((nr) => nr.node.id)).toEqual([src]);

      const stats = await reopened.stats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.relationshipCount).toBe(1);
    } finally {
      await reopened.close();
    }
  });

  it('survives ids with multiple consecutive colons', async () => {
    const { graph, dbPath } = await setup();
    const id = 'a:b:c:d:e:f';
    await graph.createNode(['Thing'], {}, id);
    await graph.close();
    const reopened = await reopen(dbPath);
    try {
      const n = await reopened.getNode(id);
      expect(n?.id).toBe(id);
      expect(ids(await reopened.allNodes())).toEqual([id]);
    } finally {
      await reopened.close();
    }
  });

  it('survives unicode ids', async () => {
    const { graph, dbPath } = await setup();
    const corpus = ['caf\u00e9', '\u4e2d\u6587\uff1ahello', '\ud83d\udd17/link:to-here', 'plain'];
    for (const id of corpus) await graph.createNode(['U'], {}, id);
    await graph.close();
    const reopened = await reopen(dbPath);
    try {
      expect(ids(await reopened.allNodes())).toEqual([...corpus].sort());
    } finally {
      await reopened.close();
    }
  });
});
