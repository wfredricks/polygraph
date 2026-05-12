/**
 * IndexManager rebuild fidelity test.
 *
 * Why: This is the canary. We seed a real PolyGraph through its public
 * API, then ask the IndexManager to rebuild from streams of the node
 * and relationship stores. Every index entry that the live writes
 * produced must also be produced by the cold rebuild — otherwise
 * indexes-after-restart will silently disagree with the persistent
 * store, and the regex bridge / qengine will return wrong answers.
 *
 * We don't mock anything. The graph is a real `PolyGraph` with the
 * default in-memory adapter, the indexes are real `IndexManager`
 * instances, and we compare the live one (built incrementally as we
 * wrote) against a fresh one rebuilt from the persisted streams.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../../engine.js';
import { IndexManager } from '../index.js';
import type { Node, Relationship } from '../../types.js';

/** Drain every node from a `PolyGraph` for rebuild. */
async function* nodeStream(graph: PolyGraph): AsyncIterable<Node> {
  const all = await graph.allNodes();
  for (const n of all) yield n;
}

/** Drain every relationship by walking each node's outgoing adjacency. */
async function* relStream(graph: PolyGraph): AsyncIterable<Relationship> {
  // The engine doesn't expose `allRelationships()` yet; we walk via
  // `findRelationships('BOUND_TO')` for the types this test seeds. The
  // real engine integration (next commit) will use a dedicated stream.
  for (const type of ['BOUND_TO', 'OWNS', 'KNOWS']) {
    const rels = await graph.findRelationships(type);
    for (const r of rels) yield r;
  }
}

describe('IndexManager — rebuild fidelity', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  it('rebuild from streams produces the same index state as incremental writes', async () => {
    // Seed via public API — 100 nodes, ~50 edges, mixed labels.
    const live = new IndexManager();

    const twins = [];
    for (let i = 0; i < 60; i++) {
      const n = await graph.createNode(['Twin'], {
        userId: `user-${i % 10}`,
        twinType: i % 2 === 0 ? 'personal' : 'contract',
        status: 'alive',
      });
      live.applyNodeCreated(n);
      twins.push(n);
    }

    const docs = [];
    for (let i = 0; i < 30; i++) {
      const n = await graph.createNode(['Document'], {
        userId: `user-${i % 10}`,
        title: `doc-${i}`,
      });
      live.applyNodeCreated(n);
      docs.push(n);
    }

    for (let i = 0; i < 10; i++) {
      // Multi-label node to stress label index
      const n = await graph.createNode(['Twin', 'Persona'], {
        userId: `user-${i}`,
      });
      live.applyNodeCreated(n);
    }

    for (let i = 0; i < 50; i++) {
      const r = await graph.createRelationship(twins[i].id, docs[i % docs.length].id, 'BOUND_TO');
      live.applyRelationshipCreated(r);
    }

    // Now rebuild a *fresh* manager from the same persisted graph.
    const cold = new IndexManager();
    await cold.rebuildFromStreams(nodeStream(graph), relStream(graph));

    // Compare label index
    expect(setSorted(cold.label.lookup('Twin'))).toEqual(setSorted(live.label.lookup('Twin')));
    expect(setSorted(cold.label.lookup('Document'))).toEqual(setSorted(live.label.lookup('Document')));
    expect(setSorted(cold.label.lookup('Persona'))).toEqual(setSorted(live.label.lookup('Persona')));
    expect(cold.label.nodeCount()).toBe(live.label.nodeCount());

    // Compare property index
    for (let u = 0; u < 10; u++) {
      const u_key = `user-${u}`;
      expect(setSorted(cold.property.lookup('Twin', 'userId', u_key)!))
        .toEqual(setSorted(live.property.lookup('Twin', 'userId', u_key)!));
      expect(setSorted(cold.property.lookup('Document', 'userId', u_key)!))
        .toEqual(setSorted(live.property.lookup('Document', 'userId', u_key)!));
    }
    expect(setSorted(cold.property.lookup('Twin', 'twinType', 'personal')!))
      .toEqual(setSorted(live.property.lookup('Twin', 'twinType', 'personal')!));

    // Compare composite index
    for (let u = 0; u < 10; u++) {
      const u_key = `user-${u}`;
      expect(setSorted(cold.composite.lookup('Twin', ['userId'], [u_key])!))
        .toEqual(setSorted(live.composite.lookup('Twin', ['userId'], [u_key])!));
    }

    // Compare adjacency index (per-node, both directions, per-type)
    const ids = (await graph.allNodes()).map((n) => n.id);
    for (const id of ids) {
      expect(setSorted(cold.adjacency.lookup(id, 'BOUND_TO', 'outgoing')))
        .toEqual(setSorted(live.adjacency.lookup(id, 'BOUND_TO', 'outgoing')));
      expect(setSorted(cold.adjacency.lookup(id, 'BOUND_TO', 'incoming')))
        .toEqual(setSorted(live.adjacency.lookup(id, 'BOUND_TO', 'incoming')));
    }
  });

  it('rebuild on an empty graph produces an empty manager', async () => {
    const cold = new IndexManager();
    await cold.rebuildFromStreams(nodeStream(graph), relStream(graph));
    expect(cold.stats()).toEqual({
      labelCount: 0,
      nodeCount: 0,
      propertyIndexCount: 0,
      adjacencyNodeCount: 0,
      compositeIndexCount: 0,
    });
  });

  it('rebuild is idempotent — calling it twice yields the same state', async () => {
    await graph.createNode(['Twin'], { userId: 'alice' });
    await graph.createNode(['Document'], { userId: 'alice' });

    const mgr = new IndexManager();
    await mgr.rebuildFromStreams(nodeStream(graph), relStream(graph));
    const firstStats = mgr.stats();

    await mgr.rebuildFromStreams(nodeStream(graph), relStream(graph));
    expect(mgr.stats()).toEqual(firstStats);
  });
});

function setSorted<T>(s: ReadonlySet<T> | null | undefined): T[] {
  if (!s) return [];
  return Array.from(s).sort();
}
