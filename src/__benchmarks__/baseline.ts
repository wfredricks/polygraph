/**
 * PolyGraph index baseline benchmark.
 *
 * Why: Before we wire in-memory indexes into the engine, we need ground
 * truth for what "fast enough" means today. This script seeds graphs of
 * 1K / 10K / 50K nodes (Twin × 60%, Document × 25%, Opportunity × 10%,
 * Conversation × 5%) and times the four operations the engine spends
 * most of its time on:
 *
 *   1. findNodes('Twin')                      — pure label scan
 *   2. findNodes('Twin', {userId: 'alice-N'}) — label + property filter
 *   3. getNeighbors(twinId, ['BOUND_TO'], 'outgoing')
 *   4. MATCH (t:Twin) WHERE t.userId = $u RETURN t  — through the
 *                                                     cypher bridge
 *   5. MATCH (t:Twin) RETURN t                — through qengine v0 (no
 *                                               WHERE support yet) + a
 *                                               JS post-filter, for an
 *                                               apples-to-apples-ish
 *                                               compare.
 *
 * Each operation is measured as the median of 100 timed runs (after a
 * short warmup) so JIT noise doesn't drown the signal. We report µs.
 *
 * Run:
 *   npx tsx src/__benchmarks__/baseline.ts                 # baseline mode
 *   POLYGRAPH_INDEXES=on npx tsx src/__benchmarks__/baseline.ts
 *
 * The env switch lets us re-run the *same* script after wiring indexes
 * in, so the two reports are directly comparable.
 */

import { PolyGraph } from '../engine.js';
import { parse } from '../qengine/parser/parse.js';
import { toLogicalPlan } from '../qengine/plan/logical.js';
import { toPhysicalPlan } from '../qengine/plan/physical.js';
import { execute } from '../qengine/exec/executor.js';

// ─── Workload generation ────────────────────────────────────────────

interface Workload {
  graph: PolyGraph;
  sampleUserId: string;          // a userId that exists in the graph
  sampleTwinId: string;          // a twinId that has at least one BOUND_TO out-edge
  totalNodes: number;
}

async function seedWorkload(targetNodes: number): Promise<Workload> {
  const graph = new PolyGraph();
  await graph.open();

  // Proportions per playbook
  const twins  = Math.floor(targetNodes * 0.60);
  const docs   = Math.floor(targetNodes * 0.25);
  const opps   = Math.floor(targetNodes * 0.10);
  const convs  = targetNodes - twins - docs - opps;

  let sampleTwinId = '';
  const twinIds: string[] = [];

  // Twins
  for (let i = 0; i < twins; i++) {
    const userId = `user-${i % Math.max(1, Math.floor(twins / 10))}`; // ~10 distinct users
    const n = await graph.createNode(['Twin'], {
      userId,
      twinType: i % 3 === 0 ? 'personal' : i % 3 === 1 ? 'contract' : 'opportunity',
      status: 'alive',
      lastPulse: '2026-05-11T00:00:00Z',
      birthrightHash: `hash-${i}`,
    });
    twinIds.push(n.id);
    if (!sampleTwinId) sampleTwinId = n.id;
  }

  // Documents
  const docIds: string[] = [];
  for (let i = 0; i < docs; i++) {
    const n = await graph.createNode(['Document'], {
      userId: `user-${i % 10}`,
      title: `doc-${i}`,
      mime: 'application/pdf',
    });
    docIds.push(n.id);
  }

  // Opportunities
  for (let i = 0; i < opps; i++) {
    await graph.createNode(['Opportunity'], {
      title: `opp-${i}`,
      stage: 'pursuit',
    });
  }

  // Conversations
  for (let i = 0; i < convs; i++) {
    await graph.createNode(['Conversation'], {
      userId: `user-${i % 10}`,
      channel: 'signal',
    });
  }

  // A handful of BOUND_TO edges from each Twin to a few docs — enough to
  // exercise getNeighbors with a realistic out-degree (~3).
  const edgesToCreate = Math.min(twins, 3000); // cap edge work
  for (let i = 0; i < edgesToCreate; i++) {
    const startId = twinIds[i];
    const endId = docIds[i % Math.max(1, docIds.length)];
    if (!endId) break;
    await graph.createRelationship(startId, endId, 'BOUND_TO');
  }

  return {
    graph,
    sampleUserId: 'user-3',
    sampleTwinId,
    totalNodes: targetNodes,
  };
}

// ─── Timing helpers ─────────────────────────────────────────────────

async function timeOne(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return (performance.now() - t0) * 1000; // µs
}

async function bench(name: string, fn: () => Promise<unknown>, runs = 100, warmup = 10): Promise<void> {
  for (let i = 0; i < warmup; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    samples.push(await timeOne(fn));
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const min = samples[0];
  console.log(
    `  ${name.padEnd(50)} median=${median.toFixed(1)}µs  p95=${p95.toFixed(1)}µs  min=${min.toFixed(1)}µs`,
  );
}

// ─── Driver ─────────────────────────────────────────────────────────

async function runForSize(size: number): Promise<void> {
  console.log(`\n=== Workload: ${size.toLocaleString()} nodes ===`);
  const t0 = performance.now();
  const wl = await seedWorkload(size);
  console.log(`  seeded in ${(performance.now() - t0).toFixed(0)}ms`);
  const stats = await wl.graph.stats();
  console.log(`  node count: ${stats.nodeCount.toLocaleString()}, rel count: ${stats.relationshipCount.toLocaleString()}`);

  // Op 1 — pure label scan
  await bench(
    `findNodes('Twin')`,
    () => wl.graph.findNodes('Twin'),
  );

  // Op 2 — label + equality filter via existing API
  await bench(
    `findNodes('Twin', {userId})`,
    () => wl.graph.findNodes('Twin', { userId: wl.sampleUserId }),
  );

  // Op 3 — typed neighbor expansion
  await bench(
    `getNeighbors(twinId, ['BOUND_TO'], 'outgoing')`,
    () => wl.graph.getNeighbors(wl.sampleTwinId, ['BOUND_TO'], 'outgoing'),
  );

  // Op 4 — cypher bridge full query
  await bench(
    `MATCH (t:Twin) WHERE t.userId=$u RETURN t (bridge)`,
    () => wl.graph.query(
      `MATCH (t:Twin) WHERE t.userId = '${wl.sampleUserId}' RETURN t`,
    ),
  );

  // Op 5 — qengine v0 path (no WHERE yet — full scan + post-filter for fairness)
  await bench(
    `MATCH (t:Twin) RETURN t (qengine v0 + post-filter)`,
    async () => {
      const ast = parse('MATCH (t:Twin) RETURN t');
      const physical = toPhysicalPlan(toLogicalPlan(ast));
      const rows: any[] = [];
      for await (const row of execute(physical, wl.graph)) {
        if (row.t?.properties?.userId === wl.sampleUserId) rows.push(row);
      }
      return rows;
    },
  );

  await wl.graph.close();
}

async function main(): Promise<void> {
  const indexesOn = process.env.POLYGRAPH_INDEXES === 'on';
  console.log(`PolyGraph index baseline benchmark — indexes=${indexesOn ? 'ON' : 'OFF'}`);
  console.log(`(median of 100 runs after 10 warmup runs, µs)`);

  const arg = process.argv[2];
  const sizes = arg ? arg.split(',').map((s) => Number(s)) : [1_000, 10_000, 50_000];
  for (const size of sizes) {
    await runForSize(size);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
