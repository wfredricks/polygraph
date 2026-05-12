/**
 * qengine executor — physical plan -> async row stream.
 *
 * Why: The executor is the iterator pipeline that turns a physical
 * plan into rows. Each operator is its own ~10-line function returning
 * an `AsyncIterableIterator<Row>`; the dispatcher (`execute`) is a
 * switch over `plan.kind`. Keeping each operator small and pure (no
 * side effects beyond the graph reads it explicitly performs) is how
 * we'll scale to Filter, Expand, OptionalExpand, and Aggregate without
 * the file turning into a mud-ball.
 *
 * The executor calls *only* documented PolyGraph primitives. v0 uses
 * `findNodes(label)`; future slices reach for `getNeighbors`,
 * `getNode`, and the indexes. That tight coupling to the storage API
 * — and *nothing else* — is the asset we are protecting.
 *
 * @tier polygraph
 * @capability qengine.exec
 * @style stateful-iterator
 */

import type { PolyGraph } from '../../engine.js';
import type { PhysicalPlan, PhysicalLabelScan, PhysicalProject } from '../plan/physical.js';
import type { Row } from '../runtime/row.js';
import { nodeToValue } from '../runtime/row.js';
import { FailLoudError } from '../runtime/errors.js';

/**
 * Run a physical plan against a PolyGraph and yield rows.
 *
 * The returned iterator is single-pass — callers should consume it
 * once into a list (or stream it onward). v0 has no back-pressure
 * concerns; we yield synchronously after each `findNodes` resolves.
 */
export async function* execute(
  plan: PhysicalPlan,
  graph: PolyGraph,
): AsyncIterableIterator<Row> {
  switch (plan.kind) {
    case 'LabelScan':
      yield* labelScan(plan, graph);
      return;

    case 'Project':
      yield* project(plan, graph);
      return;

    default: {
      const _exhaustive: never = plan;
      throw new FailLoudError(
        '',
        `executor: unknown physical operator ${(_exhaustive as { kind: string }).kind}`,
      );
    }
  }
}

// ─── Operators ─────────────────────────────────────────────────────

/**
 * LabelScan — yield one row per node carrying the given label.
 *
 * Each row binds `plan.variable` -> NodeValue. We pull the whole label
 * set into memory (PolyGraph.findNodes returns an array) because the
 * v0 storage API isn't streaming yet. When PolyGraph grows a cursor
 * API, this operator becomes a true iterator and the rest of the
 * pipeline doesn't need to change.
 */
async function* labelScan(
  plan: PhysicalLabelScan,
  graph: PolyGraph,
): AsyncIterableIterator<Row> {
  const nodes = await graph.findNodes(plan.label);
  for (const node of nodes) {
    yield { [plan.variable]: nodeToValue(node) };
  }
}

/**
 * Project — pass input rows through, emitting only the named bindings
 * under their aliases.
 *
 * v0 only handles bare-variable projection. The check is defensive:
 * the planner already refuses unbound vars, so an unresolved binding
 * here is an engine bug, not user input.
 */
async function* project(
  plan: PhysicalProject,
  graph: PolyGraph,
): AsyncIterableIterator<Row> {
  for await (const inputRow of execute(plan.input, graph)) {
    const out: Row = {};
    for (const expr of plan.expressions) {
      if (!(expr.variable in inputRow)) {
        throw new FailLoudError(
          '',
          `executor: projection references unbound variable '${expr.variable}'`,
        );
      }
      out[expr.alias] = inputRow[expr.variable];
    }
    yield out;
  }
}
