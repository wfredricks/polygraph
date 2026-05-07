/**
 * Pure function barrel export.
 *
 * Why: All pure functions in one import. The 90% of 90/10.
 */

export { matchesFilter, extractEqualityValue } from './filters.js';
export { parseCypher, whereToFilter } from './cypher.js';
export type { CypherQueryPlan, CypherNodePattern, CypherWhereClause, CypherReturnClause } from './cypher.js';
export * from './keys.js';
export * from './serialization.js';
export { bfsShortestPath, dijkstraShortestPath } from './algorithms.js';
export type { GetNeighborsFn, GetNodeFn } from './algorithms.js';
