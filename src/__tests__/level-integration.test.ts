/**
 * LevelDB Integration Tests — Full PolyGraph engine on persistent storage.
 *
 * Why: This proves PolyGraph works identically on disk as in memory.
 * The critical test: create a graph, close the database, reopen it,
 * and verify everything is intact — nodes, relationships, traversals.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { PolyGraph } from '../engine.js';
import { LevelAdapter } from '../adapters/level.js';

describe('PolyGraph on LevelDB — Persistence Integration', { timeout: 30_000 }, () => {
  const cleanups: string[] = [];

  async function createPersistentGraph(): Promise<{ graph: PolyGraph; dbPath: string }> {
    const dbPath = await mkdtemp(join(tmpdir(), 'polygraph-int-'));
    cleanups.push(dbPath);
    const graph = new PolyGraph({ adapter: new LevelAdapter({ path: dbPath }) });
    await graph.open();
    return { graph, dbPath };
  }

  async function reopenGraph(dbPath: string): Promise<PolyGraph> {
    const graph = new PolyGraph({ adapter: new LevelAdapter({ path: dbPath }) });
    await graph.open();
    return graph;
  }

  afterEach(async () => {
    for (const p of cleanups) {
      await rm(p, { recursive: true, force: true }).catch(() => {});
    }
    cleanups.length = 0;
  });

  it('should create and retrieve nodes on disk', async () => {
    const { graph } = await createPersistentGraph();

    const alice = await graph.createNode(['Person'], { name: 'Alice', age: 30 });
    const bob = await graph.createNode(['Person'], { name: 'Bob', age: 25 });

    const retrieved = await graph.getNode(alice.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.properties.name).toBe('Alice');

    const stats = await graph.stats();
    expect(stats.nodeCount).toBe(2);

    await graph.close();
  });

  it('should survive close and reopen — nodes persist', async () => {
    const { graph, dbPath } = await createPersistentGraph();

    const alice = await graph.createNode(['Person'], { name: 'Alice' });
    const bob = await graph.createNode(['Person'], { name: 'Bob' });
    const aliceId = alice.id;
    const bobId = bob.id;

    await graph.close();

    // Reopen
    const graph2 = await reopenGraph(dbPath);

    const aliceAgain = await graph2.getNode(aliceId);
    expect(aliceAgain).not.toBeNull();
    expect(aliceAgain!.properties.name).toBe('Alice');

    const bobAgain = await graph2.getNode(bobId);
    expect(bobAgain).not.toBeNull();
    expect(bobAgain!.properties.name).toBe('Bob');

    await graph2.close();
  });

  it('should survive close and reopen — relationships persist', async () => {
    const { graph, dbPath } = await createPersistentGraph();

    const alice = await graph.createNode(['Person'], { name: 'Alice' });
    const bob = await graph.createNode(['Person'], { name: 'Bob' });
    const rel = await graph.createRelationship(alice.id, bob.id, 'KNOWS', { since: 2020 });

    const aliceId = alice.id;
    const bobId = bob.id;
    const relId = rel.id;

    await graph.close();

    const graph2 = await reopenGraph(dbPath);

    const relAgain = await graph2.getRelationship(relId);
    expect(relAgain).not.toBeNull();
    expect(relAgain!.type).toBe('KNOWS');
    expect(relAgain!.startNode).toBe(aliceId);
    expect(relAgain!.endNode).toBe(bobId);
    expect(relAgain!.properties.since).toBe(2020);

    await graph2.close();
  });

  it('should survive close and reopen — traversals work', async () => {
    const { graph, dbPath } = await createPersistentGraph();

    const alice = await graph.createNode(['Person'], { name: 'Alice' });
    const bob = await graph.createNode(['Person'], { name: 'Bob' });
    const charlie = await graph.createNode(['Person'], { name: 'Charlie' });

    await graph.createRelationship(alice.id, bob.id, 'KNOWS');
    await graph.createRelationship(bob.id, charlie.id, 'KNOWS');

    const aliceId = alice.id;
    const charlieId = charlie.id;

    await graph.close();

    const graph2 = await reopenGraph(dbPath);

    // Depth-2 traversal should find both Bob and Charlie
    const friends = await graph2.traverse(aliceId).outgoing('KNOWS').depth(2).collect();
    expect(friends.length).toBe(2);

    // Shortest path should work
    const path = await graph2.shortestPath(aliceId, charlieId, {
      relationshipTypes: ['KNOWS'],
      direction: 'outgoing',
    });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);

    await graph2.close();
  });

  it('should survive close and reopen — findNodes with labels works', async () => {
    const { graph, dbPath } = await createPersistentGraph();

    await graph.createNode(['Engineer'], { name: 'Alice', level: 'senior' });
    await graph.createNode(['Engineer'], { name: 'Bob', level: 'junior' });
    await graph.createNode(['Manager'], { name: 'Charlie' });

    await graph.close();

    const graph2 = await reopenGraph(dbPath);

    const engineers = await graph2.findNodes('Engineer');
    expect(engineers.length).toBe(2);

    const managers = await graph2.findNodes('Manager');
    expect(managers.length).toBe(1);

    await graph2.close();
  });

  it('should survive close and reopen — stats are accurate', async () => {
    const { graph, dbPath } = await createPersistentGraph();

    await graph.createNode(['A'], {});
    await graph.createNode(['B'], {});
    const c = await graph.createNode(['C'], {});
    const a = await graph.findNodes('A');
    await graph.createRelationship(a[0].id, c.id, 'LINKS');

    const statsBefore = await graph.stats();
    expect(statsBefore.nodeCount).toBe(3);
    expect(statsBefore.relationshipCount).toBe(1);

    await graph.close();

    const graph2 = await reopenGraph(dbPath);

    const statsAfter = await graph2.stats();
    expect(statsAfter.nodeCount).toBe(3);
    expect(statsAfter.relationshipCount).toBe(1);

    await graph2.close();
  });

  it('should handle AuditInsight-like workload on disk', async () => {
    const { graph } = await createPersistentGraph();

    // Create 100 transaction nodes
    const txns = [];
    for (let i = 0; i < 100; i++) {
      txns.push(await graph.createNode(['Transaction'], {
        amount: Math.random() * 10000,
        vendor: `Vendor-${i % 10}`,
        date: `2026-01-${String(i % 28 + 1).padStart(2, '0')}`,
      }));
    }

    // Create clusters (every 10 txns share a cluster head)
    const clusters = [];
    for (let i = 0; i < 10; i++) {
      const cluster = await graph.createNode(['Cluster'], { clusterId: i });
      clusters.push(cluster);
      for (let j = 0; j < 10; j++) {
        await graph.createRelationship(txns[i * 10 + j].id, cluster.id, 'BELONGS_TO');
      }
    }

    // Link sequential transactions
    for (let i = 0; i < 99; i++) {
      await graph.createRelationship(txns[i].id, txns[i + 1].id, 'LINKED_TO', {
        confidence: Math.random(),
      });
    }

    const stats = await graph.stats();
    expect(stats.nodeCount).toBe(110); // 100 txns + 10 clusters
    expect(stats.relationshipCount).toBe(199); // 100 BELONGS_TO + 99 LINKED_TO

    // Traverse a chain
    const chain = await graph.traverse(txns[0].id).outgoing('LINKED_TO').depth(10).collect();
    expect(chain.length).toBe(10);

    await graph.close();
  });

  it('should handle concurrent writes on disk', async () => {
    const { graph } = await createPersistentGraph();

    const nodes = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        graph.createNode(['Concurrent'], { index: i })
      )
    );

    expect(nodes.length).toBe(50);
    const stats = await graph.stats();
    expect(stats.nodeCount).toBe(50);

    await graph.close();
  });

  /**
   * Regression for the 2026-05-12 parity-test finding: node ids that
   * contain colons (e.g. `foundation/auth:createAuthProvider`) used to
   * be silently dropped on reopen because `streamPersistedNodes`
   * extracted the node id from the label-index key with
   * `lastSegment(key)`, which split on `:` and kept only the trailing
   * token. After the fix, `allNodes()` and the rebuilt label index
   * both return the full set on reopen.
   */
  it('should rehydrate nodes whose ids contain colons (regression)', async () => {
    const { graph, dbPath } = await createPersistentGraph();

    const colonIds = [
      'foundation/auth:createAuthProvider',
      'foundation/auth:BypassProvider',
      'foundation/auth:AuthProviderInterface',
      'organism/continuity:getOperationModule',
      'a:b:c:d',
      'simple-no-colons',
    ];
    for (const id of colonIds) {
      await graph.createNode(['Thing'], { id }, id);
    }

    // Pre-close sanity: in-memory index is correct.
    const beforeAll = await graph.allNodes();
    expect(beforeAll.map((n) => n.id).sort()).toEqual([...colonIds].sort());

    await graph.close();

    // Reopen — forces `rebuildIndexes()` to walk the label-index keys
    // and parse the node ids back out. This is the path the parity
    // bug lived on.
    const reopened = await reopenGraph(dbPath);
    try {
      const afterAll = await reopened.allNodes();
      expect(afterAll.map((n) => n.id).sort()).toEqual([...colonIds].sort());

      const stats = await reopened.stats();
      expect(stats.nodeCount).toBe(colonIds.length);

      // Each node is still individually retrievable by its full id.
      for (const id of colonIds) {
        const n = await reopened.getNode(id);
        expect(n, `getNode after reopen: ${id}`).not.toBeNull();
        expect(n!.id).toBe(id);
      }

      // findNodes works through the rebuilt label index.
      const things = await reopened.findNodes('Thing');
      expect(things.length).toBe(colonIds.length);
    } finally {
      await reopened.close();
    }
  });
});
