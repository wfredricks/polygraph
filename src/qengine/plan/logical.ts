/**
 * qengine planner — AST -> logical plan.
 *
 * Why: The logical plan is what the query "wants to happen" in
 * algebraic terms, before any choice of storage strategy. For the v0
 * slice — `MATCH (n:Label) RETURN n` — that's a `NodeScan` feeding a
 * `Project`. Two operators. Calling them out as discriminated-union
 * variants now means the planner stays a pure function as new
 * operators land (Filter, Expand, OptionalExpand, Aggregate, Limit).
 *
 * The split between logical and physical plans is the future-proof
 * seam: WHERE pushdown, index choice, and join-order decisions will
 * all happen at the logical->physical step. The logical layer never
 * needs to know about indexes.
 *
 * @tier polygraph
 * @capability qengine.plan
 * @style pure
 */

import type { AstQuery } from '../parser/ast.js';
import { FailLoudError } from '../runtime/errors.js';

/**
 * Logical operator: scan every node with the given label.
 *
 * Binds the matched node to `variable` in the output row stream.
 */
export interface LogicalNodeScan {
  kind: 'NodeScan';
  variable: string;
  label: string;
}

/**
 * Logical operator: project a row through.
 *
 * Each expression names an input variable to emit, with an optional
 * output alias. v0 emits only the bound variable as-is; richer
 * projections (property access, function calls) attach here later.
 */
export interface LogicalProject {
  kind: 'Project';
  expressions: Array<{ variable: string; alias: string }>;
  input: LogicalPlan;
}

export type LogicalPlan = LogicalNodeScan | LogicalProject;

/**
 * Lower a v0 AST into a logical plan.
 *
 * v0 shape — always Project(NodeScan). The expression list contains
 * exactly the RETURN items the parser produced; v0 enforces a single
 * bare-variable expression at parse time, so this function is total.
 */
export function toLogicalPlan(ast: AstQuery): LogicalPlan {
  if (ast.matches.length !== 1) {
    throw new FailLoudError('', 'v0 supports exactly one MATCH clause');
  }
  const match = ast.matches[0];

  if (match.patterns.length !== 1) {
    throw new FailLoudError('', 'v0 supports exactly one node pattern');
  }
  const pattern = match.patterns[0];

  if (pattern.labels.length !== 1) {
    throw new FailLoudError('', 'v0 requires exactly one label per pattern');
  }

  const scan: LogicalNodeScan = {
    kind: 'NodeScan',
    variable: pattern.variable,
    label: pattern.labels[0],
  };

  const expressions = ast.return.items.map((item) => {
    if (item.expression.kind !== 'variable') {
      throw new FailLoudError(
        '',
        `v0 only projects bare variables (got expression kind '${item.expression.kind}')`,
      );
    }
    return {
      variable: item.expression.name,
      alias: item.alias ?? item.expression.name,
    };
  });

  // Sanity: every projected variable must be bound by the scan.
  for (const e of expressions) {
    if (e.variable !== scan.variable) {
      throw new FailLoudError(
        '',
        `RETURN references unbound variable '${e.variable}' (only '${scan.variable}' is in scope)`,
      );
    }
  }

  return { kind: 'Project', expressions, input: scan };
}
