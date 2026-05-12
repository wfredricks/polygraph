/**
 * qengine parser — Abstract syntax tree.
 *
 * Why: This AST is the boundary between "how we read text" and "what
 * the engine does with the query." The parser can change (regex →
 * hand-rolled → Chevrotain → ANTLR4) without disturbing the planner or
 * the executor; only this file's discriminated unions need to remain
 * stable. v0 captures only the slice — `MATCH (n:Label) RETURN n` —
 * but the shape of each node is the same one the full MVQE will use,
 * so widening this file is additive, never breaking.
 *
 * @tier polygraph
 * @capability qengine.parser
 * @style pure
 */

/** Top-level query. v0 supports exactly one MATCH and one RETURN. */
export interface AstQuery {
  kind: 'query';
  matches: AstMatch[];
  return: AstReturn;
}

/** A MATCH clause. v0 supports a single node pattern, no edges. */
export interface AstMatch {
  kind: 'match';
  patterns: AstNodePattern[];
}

/**
 * `(variable:Label)`. v0 requires the variable and exactly one label;
 * the `labels: string[]` shape is plural-ready so multi-label patterns
 * (`(n:A:B)`) and OPTIONAL label-less scans land cleanly later.
 */
export interface AstNodePattern {
  kind: 'nodePattern';
  variable: string;
  labels: string[];
}

/** A RETURN clause. v0 has one item; structure scales without rework. */
export interface AstReturn {
  kind: 'return';
  items: AstReturnItem[];
}

/** A single RETURN expression with optional alias. */
export interface AstReturnItem {
  kind: 'returnItem';
  expression: AstExpression;
  alias?: string;
}

/**
 * A query expression.
 *
 * v0 supports only bare variable references. Future versions will add
 * literals, property access (`n.prop`), and function calls; each new
 * variant is an added union member and a new evaluator case.
 */
export type AstExpression =
  | { kind: 'variable'; name: string };
