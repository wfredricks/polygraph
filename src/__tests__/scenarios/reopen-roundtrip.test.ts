/**
 * Scenario: write \u2192 close \u2192 reopen \u2192 read fidelity.
 *
 * Why: PolyGraph keeps in-memory indexes that are derived state. When
 * the process exits, those indexes vanish; on the next `open()`, the
 * engine has to rebuild them by streaming every persisted node and
 * relationship back through `applyNodeCreated` / `applyRelationshipCreated`.
 * That rebuild path is the single most consequential read in the
 * lifetime of a long-lived store \u2014 if it drops a node, every read
 * after will lie about what the store contains.
 *
 * The 2026-05-12 colon-id bug lived here. These tests pin the
 * rebuild invariant: *the store after reopen is observationally
 * identical to the store before close.*
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, freshGraph, ids, reopen, type Scratch } from './_helpers.js';

describe('Scenario: write \u2192 close \u2192 reopen \u2192 read fidelity', { timeout: 60_000 }, () => {
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

  it('rebuilt allNodes / stats / findNodes agree on count for a small mixed graph', async () => {
    const { graph, dbPath } = await setup();

    // 5 labels, 10 nodes per label, half with colon-ids, plus 5
    // multi-label nodes. 55 nodes total, distinct ids.
    const expectedIds = new Set<string>();
    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      for (let i = 0; i < 10; i++) {
        const id = i < 5 ? `${label}/${i}:thing` : `${label}-${i}`;
        await graph.createNode([label], { i }, id);
        expectedIds.add(id);
      }
    }
    for (let i = 0; i < 5; i++) {
      const id = `multi:${i}`;
      await graph.createNode(['A', 'B', 'C'], { i }, id);
      expectedIds.add(id);
    }
    expect(expectedIds.size).toBe(55);

    const beforeAll = ids(await graph.allNodes());
    const beforeStats = await graph.stats();
    expect(beforeAll).toEqual([...expectedIds].sort());
    expect(beforeStats.nodeCount).toBe(55);

    await graph.close();
    const reopened = await reopen(dbPath);
    try {
      const afterAll = ids(await reopened.allNodes());
      const afterStats = await reopened.stats();

      expect(afterAll).toEqual(beforeAll);
      expect(afterStats.nodeCount).toBe(beforeStats.nodeCount);
      expect(afterStats.relationshipCount).toBe(beforeStats.relationshipCount);

      // The three counters must agree with each other.
      const sumByLabel =
        (await reopened.findNodes('A')).length +
        (await reopened.findNodes('B')).length +
        (await reopened.findNodes('C')).length +
        (await reopened.findNodes('D')).length +
        (await reopened.findNodes('E')).length;
      // 50 single-label nodes + 5 multi-label that count once per label = 50 + 15 = 65.
      expect(sumByLabel).toBe(65);

      // allNodes counts each node exactly once regardless of label cardinality.
      expect(afterAll.length).toBe(55);
    } finally {
      await reopened.close();
    }
  });

  it('rebuilt adjacency index is identical to the pre-close one', async () => {
    const { graph, dbPath } = await setup();

    // A small DAG: 3 SourceFiles each EXPORTS several Functions; one
    // Function is shared (incoming edges from two SourceFiles).
    await graph.createNode(['SourceFile'], {}, 'a.ts');
    await graph.createNode(['SourceFile'], {}, 'b.ts');
    await graph.createNode(['SourceFile'], {}, 'c.ts');
    await graph.createNode(['Function'], {}, 'mod/a:f1');
    await graph.createNode(['Function'], {}, 'mod/a:f2');
    await graph.createNode(['Function'], {}, 'mod/b:g1');
    await graph.createNode(['Function'], {}, 'mod/shared:helper');

    const edges: Array<[string, string]> = [
      ['a.ts', 'mod/a:f1'],
      ['a.ts', 'mod/a:f2'],
      ['a.ts', 'mod/shared:helper'],
      ['b.ts', 'mod/b:g1'],
      ['b.ts', 'mod/shared:helper'],
    ];
    for (const [s, t] of edges) {
      await graph.createRelationship(s, t, 'EXPORTS');
    }

    async function neighborSummary(g: typeof graph) {
      const out = new Map<string, string[]>();
      const inn = new Map<string, string[]>();
      for (const src of ['a.ts', 'b.ts', 'c.ts']) {
        const n = await g.getNeighbors(src, ['EXPORTS'], 'outgoing');
        out.set(src, n.map((nr) => nr.node.id).sort());
      }
      for (const dst of ['mod/a:f1', 'mod/a:f2', 'mod/b:g1', 'mod/shared:helper']) {
        const n = await g.getNeighbors(dst, ['EXPORTS'], 'incoming');
        inn.set(dst, n.map((nr) => nr.node.id).sort());
      }
      return {
        out: JSON.stringify([...out.entries()].sort()),
        inn: JSON.stringify([...inn.entries()].sort()),
      };
    }

    const before = await neighborSummary(graph);
    await graph.close();

    const reopened = await reopen(dbPath);
    try {
      const after = await neighborSummary(reopened);
      expect(after.out).toBe(before.out);
      expect(after.inn).toBe(before.inn);
    } finally {
      await reopened.close();
    }
  });

  it('rebuilt store still honours deletes that happened before close', async () => {
    const { graph, dbPath } = await setup();

    await graph.createNode(['T'], { keep: true }, 'keeper');
    await graph.createNode(['T'], { keep: false }, 'doomed');
    await graph.createRelationship('keeper', 'doomed', 'POINTS_TO');

    // Delete the doomed node \u2014 cascade should drop the relationship.
    await graph.deleteNode('doomed');

    expect(ids(await graph.allNodes())).toEqual(['keeper']);
    expect((await graph.getNeighbors('keeper', ['POINTS_TO'], 'outgoing')).length).toBe(0);
    const preStats = await graph.stats();
    expect(preStats.nodeCount).toBe(1);
    expect(preStats.relationshipCount).toBe(0);

    await graph.close();
    const reopened = await reopen(dbPath);
    try {
      // The deletes have to stick across reopen, and the rebuild
      // must not resurrect the doomed node or its edges from any
      // residual key.
      expect(ids(await reopened.allNodes())).toEqual(['keeper']);
      expect((await reopened.stats()).nodeCount).toBe(1);
      expect((await reopened.stats()).relationshipCount).toBe(0);
      expect(await reopened.getNode('doomed')).toBeNull();
      expect(
        (await reopened.getNeighbors('keeper', ['POINTS_TO'], 'outgoing')).length,
      ).toBe(0);
    } finally {
      await reopened.close();
    }
  });

  it('two-cycle reopen is idempotent (rebuild is deterministic)', async () => {
    const { graph, dbPath } = await setup();

    const seed = [
      ['Function', 'a/b:c'],
      ['Function', 'a/b:d'],
      ['SourceFile', 'a/b.ts'],
    ] as const;
    for (const [label, id] of seed) await graph.createNode([label], {}, id);
    await graph.createRelationship('a/b.ts', 'a/b:c', 'EXPORTS');
    await graph.createRelationship('a/b.ts', 'a/b:d', 'EXPORTS');

    const snap1 = {
      all: ids(await graph.allNodes()),
      stats: await graph.stats(),
    };
    await graph.close();

    const r1 = await reopen(dbPath);
    const snap2 = {
      all: ids(await r1.allNodes()),
      stats: await r1.stats(),
    };
    await r1.close();

    const r2 = await reopen(dbPath);
    try {
      const snap3 = {
        all: ids(await r2.allNodes()),
        stats: await r2.stats(),
      };
      expect(snap2.all).toEqual(snap1.all);
      expect(snap3.all).toEqual(snap1.all);
      expect(snap2.stats).toEqual(snap1.stats);
      expect(snap3.stats).toEqual(snap1.stats);
    } finally {
      await r2.close();
    }
  });
});
