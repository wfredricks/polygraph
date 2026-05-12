/**
 * qengine — public entry point for the v0 query engine.
 *
 * Why: This module is the parallel successor to the regex bridge in
 * `polygraph-local/src/pure/cypher.ts`. It is intentionally *additive*
 * — wiring it into `PolyGraphReader.query()` is a future graduation
 * step, gated on coverage of the 18 patterns in
 * `docs/overnight/ENGINE-SCOPING-RESULTS.md`. For v0 it is exercised
 * by its own tests and by anyone who imports `executeQuery` directly.
 *
 * Architecture (matches the scoping doc):
 *
 *   cypher string -> parse() -> AST -> toLogicalPlan() -> LogicalPlan
 *     -> toPhysicalPlan() -> PhysicalPlan -> execute() -> Row[]
 *
 * Every arrow is a pure function except `execute`, which is an async
 * iterator over storage I/O.
 *
 * @tier polygraph
 * @capability qengine.entry
 * @style stateless-facade
 */

import type { PolyGraph } from '../engine.js';
import { parse } from './parser/parse.js';
import { toLogicalPlan } from './plan/logical.js';
import { toPhysicalPlan, type PhysicalPlan, type GraphStats } from './plan/physical.js';
import { execute } from './exec/executor.js';
import type { Row } from './runtime/row.js';

export type { PhysicalPlan } from './plan/physical.js';
export type { LogicalPlan } from './plan/logical.js';
export type { Row, NodeValue, EdgeValue, GraphValue } from './runtime/row.js';
export type { AstQuery } from './parser/ast.js';
export { FailLoudError } from './runtime/errors.js';

/**
 * Result returned by `executeQuery`.
 *
 * Mirrors the shape of `GraphReader.query`'s result so the engine can
 * eventually slot into that API surface unchanged.
 */
export interface ExecuteResult {
  records: Row[];
  summary: {
    plan: PhysicalPlan;
    /** Walltime in milliseconds, rounded to the nearest integer. */
    executionTimeMs: number;
  };
}

/**
 * Execute a v0-slice cypher query against a PolyGraph.
 *
 * `params` is accepted for API stability — the v0 grammar refuses any
 * `$param` reference, so the runtime never reads this object. The
 * argument stays because the next slice (WHERE + parameters) will
 * need it and we don't want every call site to change shape twice.
 */
export async function executeQuery(
  graph: PolyGraph,
  cypher: string,
  _params: Record<string, unknown> = {},
): Promise<ExecuteResult> {
  const start = performance.now();

  const ast = parse(cypher);
  const logical = toLogicalPlan(ast);
  const stats: GraphStats = {}; // v0 placeholder — see plan/physical.ts
  const physical = toPhysicalPlan(logical, stats);

  const rows: Row[] = [];
  for await (const row of execute(physical, graph)) {
    rows.push(row);
  }

  return {
    records: rows,
    summary: {
      plan: physical,
      executionTimeMs: Math.round(performance.now() - start),
    },
  };
}
