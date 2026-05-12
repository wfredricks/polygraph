/**
 * qengine planner — logical -> physical plan.
 *
 * Why: A separate physical layer is where storage choices live —
 * LabelScan vs FullScan vs IndexScan, NestedExpand vs HashJoin, push-
 * down or not. For the v0 slice it's a 1:1 lowering (LogicalNodeScan
 * becomes a LabelScan because PolyGraph already has a label index
 * we'd be foolish not to use); the `stats` parameter is unused, but
 * the *API shape* is the one a real planner needs, and matching it
 * now means future work doesn't have to rewrite call sites.
 *
 * @tier polygraph
 * @capability qengine.plan
 * @style pure
 */

import type { LogicalPlan } from './logical.js';
import { FailLoudError } from '../runtime/errors.js';

/**
 * Stats passed to the planner.
 *
 * v0 carries no fields — it's a placeholder so the planner's signature
 * is stable. A future revision will include label cardinalities,
 * index definitions, and selectivity histograms.
 */
export interface GraphStats {
  /** Reserved. Empty in v0. */
  labels?: Record<string, { nodeCount: number }>;
}

/** Physical scan: walk PolyGraph's label index. */
export interface PhysicalLabelScan {
  kind: 'LabelScan';
  variable: string;
  label: string;
}

/** Physical projection: emit a row with the named bindings. */
export interface PhysicalProject {
  kind: 'Project';
  expressions: Array<{ variable: string; alias: string }>;
  input: PhysicalPlan;
}

export type PhysicalPlan = PhysicalLabelScan | PhysicalProject;

/**
 * Lower a logical plan into a physical plan.
 *
 * v0 is a direct mapping: NodeScan -> LabelScan, Project -> Project.
 * Future strategies (full scan, index scan, push-down filters) attach
 * here as new branches of the switch and stay invisible to the AST
 * and executor APIs.
 */
export function toPhysicalPlan(
  logical: LogicalPlan,
  _stats: GraphStats,
): PhysicalPlan {
  switch (logical.kind) {
    case 'NodeScan':
      return {
        kind: 'LabelScan',
        variable: logical.variable,
        label: logical.label,
      };

    case 'Project':
      return {
        kind: 'Project',
        expressions: [...logical.expressions],
        input: toPhysicalPlan(logical.input, _stats),
      };

    default: {
      // Exhaustiveness check; unreachable in v0.
      const _exhaustive: never = logical;
      throw new FailLoudError(
        '',
        `physical planner: unknown logical operator ${(_exhaustive as { kind: string }).kind}`,
      );
    }
  }
}
