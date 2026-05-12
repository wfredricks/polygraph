/**
 * Shared helpers for the scenarios suite.
 *
 * Why: every scenario file follows the same lifecycle — temp dir,
 * open, populate, optionally close+reopen, assert, cleanup. Putting
 * the boilerplate here keeps each scenario file focused on the
 * *shape* it's testing.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PolyGraph } from '../../engine.js';
import { LevelAdapter } from '../../adapters/level.js';

export interface Scratch {
  graph: PolyGraph;
  dbPath: string;
}

/** Caller is responsible for calling `cleanup(scratch.dbPath)`. */
export async function freshGraph(prefix = 'polygraph-scenario-'): Promise<Scratch> {
  const dbPath = await mkdtemp(join(tmpdir(), prefix));
  const graph = new PolyGraph({ adapter: new LevelAdapter({ path: dbPath }) });
  await graph.open();
  return { graph, dbPath };
}

/** Reopen a store at the given path. Caller still owns cleanup. */
export async function reopen(dbPath: string): Promise<PolyGraph> {
  const graph = new PolyGraph({ adapter: new LevelAdapter({ path: dbPath }) });
  await graph.open();
  return graph;
}

export async function cleanup(dbPath: string): Promise<void> {
  await rm(dbPath, { recursive: true, force: true }).catch(() => {});
}

/** Sort + return ids — used everywhere we compare result sets. */
export function ids(nodes: Array<{ id: string }>): string[] {
  return nodes.map((n) => n.id).sort();
}
