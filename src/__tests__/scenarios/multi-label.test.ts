/**
 * Scenario: multi-label nodes.
 *
 * Why: PolyGraph's Node model is `{ id, labels: string[], properties }`
 * \u2014 a node can carry any number of labels, and every read path must
 * honour them. Single-label is the simple case the engine grew up on;
 * multi-label is where label-index entries multiply, addLabel/removeLabel
 * have to keep state in sync, and a label-filtered traversal has to
 * include a node only if it carries the asked-for label even when it
 * carries others.
 *
 * The 2026-05-12 parity test surfaced a related loader-side bug (Neo4j
 * was modelling the same logical thing as two single-label nodes; the
 * loader collided them on the chosen PolyGraph id). The fix moved the
 * union logic into the loader, but it relies on PolyGraph correctly
 * storing and rehydrating multi-label nodes \u2014 which is what these
 * tests pin.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, freshGraph, ids, reopen, type Scratch } from './_helpers.js';

describe('Scenario: multi-label nodes', { timeout: 30_000 }, () => {
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

  it('stores all labels passed to createNode', async () => {
    const { graph } = await setup();
    const id = 'REQ-BOOT-01';
    await graph.createNode(['Requirement', 'PlannedRequirement'], { id }, id);

    const n = await graph.getNode(id);
    expect(n?.labels.sort()).toEqual(['PlannedRequirement', 'Requirement']);

    expect(await graph.hasLabel(id, 'Requirement')).toBe(true);
    expect(await graph.hasLabel(id, 'PlannedRequirement')).toBe(true);
    expect(await graph.hasLabel(id, 'Function')).toBe(false);

    await graph.close();
  });

  it('appears in every label\u2019s findNodes result', async () => {
    const { graph } = await setup();
    const id = 'REQ-BOOT-01';
    await graph.createNode(['Requirement', 'PlannedRequirement'], { id }, id);
    await graph.createNode(['Requirement'], { id: 'REQ-A' }, 'REQ-A');
    await graph.createNode(['PlannedRequirement'], { id: 'REQ-P' }, 'REQ-P');

    const reqs = await graph.findNodes('Requirement');
    const planned = await graph.findNodes('PlannedRequirement');

    expect(ids(reqs)).toEqual(['REQ-A', 'REQ-BOOT-01']);
    expect(ids(planned)).toEqual(['REQ-BOOT-01', 'REQ-P']);

    // allNodes dedupes by id (the multi-label node appears once).
    const all = await graph.allNodes();
    expect(ids(all)).toEqual(['REQ-A', 'REQ-BOOT-01', 'REQ-P']);

    await graph.close();
  });

  it('survives close + reopen with both labels intact', async () => {
    const { graph, dbPath } = await setup();
    await graph.createNode(['Requirement', 'PlannedRequirement'], {}, 'REQ-BOOT-01');
    await graph.createNode(['Function', 'Exported', 'Public'], {}, 'foundation/auth:createAuthProvider');
    await graph.close();

    const reopened = await reopen(dbPath);
    try {
      const a = await reopened.getNode('REQ-BOOT-01');
      expect(a?.labels.sort()).toEqual(['PlannedRequirement', 'Requirement']);

      const b = await reopened.getNode('foundation/auth:createAuthProvider');
      expect(b?.labels.sort()).toEqual(['Exported', 'Function', 'Public']);

      // Each label re-indexes correctly after rebuild.
      expect(ids(await reopened.findNodes('Requirement'))).toEqual(['REQ-BOOT-01']);
      expect(ids(await reopened.findNodes('PlannedRequirement'))).toEqual(['REQ-BOOT-01']);
      expect(ids(await reopened.findNodes('Function'))).toEqual(['foundation/auth:createAuthProvider']);
      expect(ids(await reopened.findNodes('Exported'))).toEqual(['foundation/auth:createAuthProvider']);
      expect(ids(await reopened.findNodes('Public'))).toEqual(['foundation/auth:createAuthProvider']);

      // Stats counter holds 2 nodes regardless of label count.
      expect((await reopened.stats()).nodeCount).toBe(2);
    } finally {
      await reopened.close();
    }
  });

  it('addLabel / removeLabel mutate the read paths consistently', async () => {
    const { graph, dbPath } = await setup();
    const id = 'evolve';
    await graph.createNode(['Requirement'], {}, id);

    expect(ids(await graph.findNodes('Requirement'))).toEqual([id]);
    expect(ids(await graph.findNodes('PlannedRequirement'))).toEqual([]);

    await graph.addLabel(id, 'PlannedRequirement');
    expect(ids(await graph.findNodes('PlannedRequirement'))).toEqual([id]);
    expect(ids(await graph.findNodes('Requirement'))).toEqual([id]);
    expect((await graph.getNode(id))?.labels.sort()).toEqual(['PlannedRequirement', 'Requirement']);

    await graph.removeLabel(id, 'Requirement');
    expect(ids(await graph.findNodes('Requirement'))).toEqual([]);
    expect(ids(await graph.findNodes('PlannedRequirement'))).toEqual([id]);
    expect((await graph.getNode(id))?.labels).toEqual(['PlannedRequirement']);

    // Persistence: changes survive reopen.
    await graph.close();
    const reopened = await reopen(dbPath);
    try {
      expect(ids(await reopened.findNodes('Requirement'))).toEqual([]);
      expect(ids(await reopened.findNodes('PlannedRequirement'))).toEqual([id]);
      const n = await reopened.getNode(id);
      expect(n?.labels).toEqual(['PlannedRequirement']);
    } finally {
      await reopened.close();
    }
  });

  it('deleting a multi-label node vacates every label\u2019s bucket', async () => {
    const { graph, dbPath } = await setup();
    const id = 'doomed';
    await graph.createNode(['A', 'B', 'C'], {}, id);
    await graph.createNode(['A'], {}, 'survivor');

    await graph.deleteNode(id);

    expect(ids(await graph.findNodes('A'))).toEqual(['survivor']);
    expect(ids(await graph.findNodes('B'))).toEqual([]);
    expect(ids(await graph.findNodes('C'))).toEqual([]);
    expect((await graph.stats()).nodeCount).toBe(1);

    await graph.close();
    const reopened = await reopen(dbPath);
    try {
      expect(ids(await reopened.findNodes('A'))).toEqual(['survivor']);
      expect(ids(await reopened.findNodes('B'))).toEqual([]);
      expect(ids(await reopened.findNodes('C'))).toEqual([]);
    } finally {
      await reopened.close();
    }
  });

  it('label-filtered traversal honours multi-label endpoints', async () => {
    const { graph } = await setup();
    // src EXPORTS three Functions; one is also a Public class.
    await graph.createNode(['SourceFile'], {}, 'src.ts');
    await graph.createNode(['Function'], {}, 'fnA');
    await graph.createNode(['Function', 'Public'], {}, 'fnB');
    await graph.createNode(['Function'], {}, 'fnC');
    for (const t of ['fnA', 'fnB', 'fnC']) {
      await graph.createRelationship('src.ts', t, 'EXPORTS');
    }

    const neighbors = await graph.getNeighbors('src.ts', ['EXPORTS'], 'outgoing');
    expect(neighbors.length).toBe(3);

    // A consumer-side filter for "EXPORTS targets that are Public":
    // honours the multi-label property of fnB.
    const publicTargets = neighbors
      .filter((nr) => nr.node.labels.includes('Public'))
      .map((nr) => nr.node.id);
    expect(publicTargets).toEqual(['fnB']);

    await graph.close();
  });
});
