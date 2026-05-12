/**
 * qengine v0 end-to-end slice test.
 *
 * Why: Proves the architectural sketch in
 * `docs/overnight/ENGINE-SCOPING-RESULTS.md` works end-to-end for one
 * pattern — `MATCH (n:Label) RETURN n`. This is the canary that
 * confirms every layer (parse, logical, physical, execute) is real
 * code that produces correct output against a real PolyGraph.
 *
 * Also runs a differential test against the existing PolyGraph regex
 * bridge (`graph.query`) — for the slice pattern, the new engine and
 * the bridge MUST return the same set of node ids. That equivalence
 * is what gates the next slice and, eventually, the graduation of
 * qengine into PolyGraphReader.query().
 *
 * No mocks. Real PolyGraph with the MemoryAdapter.
 *
 * @requirement REQ-QENGINE-SLICE-01..06
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PolyGraph } from '../../engine.js';
import { MemoryAdapter } from '../../adapters/memory.js';
import { executeQuery, type NodeValue } from '../index.js';
import { FailLoudError } from '../runtime/errors.js';

describe('qengine v0 — MATCH (n:Label) RETURN n', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph({ adapter: new MemoryAdapter() });
    await graph.open();
  });

  afterEach(async () => {
    await graph.close();
  });

  it('returns one record per node with the given label', async () => {
    await graph.createNode(['Twin'], { id: 't1', name: 'Alice' });
    await graph.createNode(['Twin'], { id: 't2', name: 'Bob' });
    await graph.createNode(['Twin'], { id: 't3', name: 'Carol' });
    await graph.createNode(['Document'], { id: 'd1', title: 'A note' });
    await graph.createNode(['Document'], { id: 'd2', title: 'Another note' });

    const result = await executeQuery(graph, 'MATCH (n:Twin) RETURN n');

    expect(result.records).toHaveLength(3);
    for (const row of result.records) {
      const n = row.n as NodeValue;
      expect(n.kind).toBe('node');
      expect(n.labels).toContain('Twin');
    }

    const ids = result.records.map((r) => (r.n as NodeValue).properties.id).sort();
    expect(ids).toEqual(['t1', 't2', 't3']);
  });

  it('returns an empty record set when no nodes match the label', async () => {
    await graph.createNode(['Twin'], { id: 't1' });

    const result = await executeQuery(graph, 'MATCH (n:Document) RETURN n');

    expect(result.records).toHaveLength(0);
  });

  it('returns the (LabelScan-fed) physical plan in the summary', async () => {
    const result = await executeQuery(graph, 'MATCH (n:Twin) RETURN n');

    expect(result.summary.plan.kind).toBe('Project');
    if (result.summary.plan.kind !== 'Project') return; // for the type narrower
    const inner = result.summary.plan.input;
    expect(inner.kind).toBe('LabelScan');
    if (inner.kind !== 'LabelScan') return; // for the type narrower
    expect(inner.label).toBe('Twin');
    expect(inner.variable).toBe('n');
  });

  it('records a non-negative executionTimeMs in the summary', async () => {
    await graph.createNode(['Twin'], { id: 't1' });
    const result = await executeQuery(graph, 'MATCH (n:Twin) RETURN n');
    expect(result.summary.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('binds the node under the variable name from the pattern', async () => {
    await graph.createNode(['CodifiedAlgorithm'], { id: 'algo-1' });

    const result = await executeQuery(
      graph,
      'MATCH (twin:CodifiedAlgorithm) RETURN twin',
    );

    expect(result.records).toHaveLength(1);
    const v = result.records[0].twin as NodeValue;
    expect(v.kind).toBe('node');
    expect(v.properties.id).toBe('algo-1');
  });

  it('uses the alias from RETURN ... AS', async () => {
    await graph.createNode(['Twin'], { id: 't1' });

    const result = await executeQuery(graph, 'MATCH (n:Twin) RETURN n AS twin');

    expect(result.records).toHaveLength(1);
    expect(result.records[0].twin).toBeDefined();
    expect(result.records[0].n).toBeUndefined();
  });

  it('emits an immutable copy of node properties (mutation safety)', async () => {
    await graph.createNode(['Twin'], { id: 't1', name: 'Alice' });

    const result = await executeQuery(graph, 'MATCH (n:Twin) RETURN n');
    const v = result.records[0].n as NodeValue;
    (v.properties as Record<string, unknown>).name = 'Mallory';

    // Re-querying must show the original value — the executor returned
    // a copy, not a reference to the stored properties.
    const result2 = await executeQuery(graph, 'MATCH (n:Twin) RETURN n');
    const v2 = result2.records[0].n as NodeValue;
    expect(v2.properties.name).toBe('Alice');
  });

  describe('fail-loud refusals', () => {
    it('throws FailLoudError on edge patterns', async () => {
      await expect(
        executeQuery(graph, 'MATCH (n:Twin)-[r:KNOWS]->(m:Twin) RETURN n'),
      ).rejects.toThrow(FailLoudError);
      await expect(
        executeQuery(graph, 'MATCH (n:Twin)-[r:KNOWS]->(m:Twin) RETURN n'),
      ).rejects.toThrow(/not supported in v0: edge patterns/i);
    });

    it('throws FailLoudError on WHERE clauses', async () => {
      await expect(
        executeQuery(graph, 'MATCH (n:Twin) WHERE n.id = "x" RETURN n'),
      ).rejects.toThrow(FailLoudError);
    });

    it('throws FailLoudError on parameter references', async () => {
      await expect(
        executeQuery(graph, 'MATCH (n:Twin) RETURN $x'),
      ).rejects.toThrow(/not supported in v0: parameters/i);
    });

    it('throws FailLoudError on empty cypher', async () => {
      await expect(executeQuery(graph, '')).rejects.toThrow(/empty query/i);
    });
  });

  describe('differential test vs. PolyGraph regex bridge', () => {
    it('returns the same node ids as PolyGraph.query() for the slice pattern', async () => {
      // Seed identical data, then run both paths against the same graph
      // instance. Their record counts and the set of node ids they
      // surface must match — that's the equivalence we're protecting.
      await graph.createNode(['Twin'], { id: 't1', name: 'Alice' });
      await graph.createNode(['Twin'], { id: 't2', name: 'Bob' });
      await graph.createNode(['Twin'], { id: 't3', name: 'Carol' });
      await graph.createNode(['Document'], { id: 'd1' });

      const cypher = 'MATCH (n:Twin) RETURN n';

      const bridgeResult = await graph.query(cypher);
      const engineResult = await executeQuery(graph, cypher);

      expect(engineResult.records.length).toBe(bridgeResult.length);

      const bridgeIds = (bridgeResult as Array<{ n: { properties: { id: string } } }>)
        .map((row) => row.n.properties.id)
        .sort();
      const engineIds = engineResult.records
        .map((row) => (row.n as NodeValue).properties.id)
        .sort();

      expect(engineIds).toEqual(bridgeIds);
    });

    it('returns the same empty result as the bridge when no nodes match', async () => {
      await graph.createNode(['Twin'], { id: 't1' });
      const cypher = 'MATCH (n:DoesNotExist) RETURN n';

      const bridgeResult = await graph.query(cypher);
      const engineResult = await executeQuery(graph, cypher);

      expect(engineResult.records).toHaveLength(0);
      expect(bridgeResult).toHaveLength(0);
    });
  });
});
