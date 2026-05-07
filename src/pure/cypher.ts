/**
 * Lightweight Cypher Bridge — Pattern matching subset of Cypher.
 *
 * Why: Developers coming from Neo4j think in Cypher. This bridge parses
 * the most common Cypher patterns and translates them into PolyGraph API
 * calls. It's not a full Cypher implementation — it's a bridge that covers
 * ~80% of real-world queries.
 *
 * Supported:
 *   MATCH (n:Label)-[:REL_TYPE]->(m:Label)
 *   WHERE n.prop = value AND m.prop > value
 *   RETURN n, m, n.prop
 *   CREATE (n:Label {prop: value})
 *   CREATE (n)-[:REL_TYPE {prop: value}]->(m)
 *   DELETE n
 *   SET n.prop = value
 *   LIMIT n
 *
 * Architecture: 90% pure functions / 10% I/O shell. This is the 90%.
 * The parser returns a query plan; the engine executes it.
 */

import type { PropertyFilter } from '../types.js';

// ─── AST Types ─────────────────────────────────────────────────────

export interface CypherNodePattern {
  variable?: string;
  labels: string[];
  properties?: Record<string, any>;
}

export interface CypherRelPattern {
  variable?: string;
  type?: string;
  direction: 'outgoing' | 'incoming' | 'both';
  properties?: Record<string, any>;
}

export interface CypherPathPattern {
  start: CypherNodePattern;
  segments: Array<{
    rel: CypherRelPattern;
    node: CypherNodePattern;
  }>;
}

export interface CypherWhereClause {
  conditions: Array<{
    variable: string;
    property: string;
    operator: string;
    value: any;
  }>;
}

export interface CypherReturnClause {
  items: Array<{
    variable: string;
    property?: string;
    alias?: string;
  }>;
}

export interface CypherSetClause {
  assignments: Array<{
    variable: string;
    property: string;
    value: any;
  }>;
}

export type CypherQueryPlan =
  | { type: 'match'; pattern: CypherPathPattern; where?: CypherWhereClause; returns?: CypherReturnClause; limit?: number; delete?: string[] }
  | { type: 'create-node'; node: CypherNodePattern }
  | { type: 'create-path'; pattern: CypherPathPattern }
  | { type: 'match-set'; pattern: CypherPathPattern; where?: CypherWhereClause; set: CypherSetClause }
  | { type: 'match-delete'; pattern: CypherPathPattern; where?: CypherWhereClause; delete: string[] };

// ─── Parser ────────────────────────────────────────────────────────

/**
 * Parses a lightweight Cypher query into a query plan.
 *
 * Why: Pure function — takes a string, returns structured data.
 * No I/O, no side effects, easily testable.
 */
export function parseCypher(query: string): CypherQueryPlan {
  const trimmed = query.trim();

  if (/^CREATE\s*\(/i.test(trimmed)) {
    return parseCreate(trimmed);
  }

  if (/^MATCH\b/i.test(trimmed)) {
    return parseMatch(trimmed);
  }

  throw new Error(`Unsupported Cypher query: ${trimmed.substring(0, 50)}...`);
}

function parseCreate(query: string): CypherQueryPlan {
  // CREATE (n:Label {prop: value})-[:REL]->(m:Label {prop: value})
  // or CREATE (n:Label {prop: value})
  const pathMatch = query.match(
    /^CREATE\s+(\([^)]*\))\s*(-\[.*?\]-[>]?\s*\([^)]*\))?/i
  );

  if (!pathMatch) {
    throw new Error(`Cannot parse CREATE: ${query.substring(0, 80)}`);
  }

  const startNode = parseNodePattern(pathMatch[1]);

  if (pathMatch[2]) {
    // CREATE path: (n)-[:REL]->(m)
    const segmentStr = pathMatch[2].trim();
    const segment = parseRelAndNode(segmentStr);
    return {
      type: 'create-path',
      pattern: {
        start: startNode,
        segments: [segment],
      },
    };
  }

  return { type: 'create-node', node: startNode };
}

function parseMatch(query: string): CypherQueryPlan {
  // Split into clauses
  const matchPart = extractClause(query, 'MATCH', ['WHERE', 'RETURN', 'SET', 'DELETE', 'LIMIT']);
  const wherePart = extractClause(query, 'WHERE', ['RETURN', 'SET', 'DELETE', 'LIMIT']);
  const returnPart = extractClause(query, 'RETURN', ['LIMIT', 'SET', 'DELETE']);
  const setPart = extractClause(query, 'SET', ['RETURN', 'LIMIT', 'DELETE']);
  const deletePart = extractClause(query, 'DELETE', ['RETURN', 'LIMIT', 'SET']);
  const limitPart = extractClause(query, 'LIMIT', []);

  if (!matchPart) {
    throw new Error(`Cannot parse MATCH clause: ${query.substring(0, 80)}`);
  }

  const pattern = parsePathPattern(matchPart);
  const where = wherePart ? parseWhere(wherePart) : undefined;
  const returns = returnPart ? parseReturn(returnPart) : undefined;
  const limit = limitPart ? parseInt(limitPart.trim(), 10) : undefined;

  if (setPart) {
    return {
      type: 'match-set',
      pattern,
      where,
      set: parseSet(setPart),
    };
  }

  if (deletePart) {
    const deleteVars = deletePart.split(',').map((v) => v.trim());
    return {
      type: 'match-delete',
      pattern,
      where,
      delete: deleteVars,
    };
  }

  return {
    type: 'match',
    pattern,
    where,
    returns,
    limit,
  };
}

// ─── Clause Extraction ─────────────────────────────────────────────

function extractClause(query: string, clause: string, terminators: string[]): string | null {
  const clauseRegex = new RegExp(`\\b${clause}\\b\\s+`, 'i');
  const match = query.match(clauseRegex);
  if (!match || match.index === undefined) return null;

  const start = match.index + match[0].length;
  let end = query.length;

  for (const term of terminators) {
    const termRegex = new RegExp(`\\b${term}\\b`, 'i');
    const termMatch = query.substring(start).match(termRegex);
    if (termMatch && termMatch.index !== undefined) {
      end = Math.min(end, start + termMatch.index);
    }
  }

  return query.substring(start, end).trim();
}

// ─── Pattern Parsing ───────────────────────────────────────────────

function parsePathPattern(pattern: string): CypherPathPattern {
  // Match the start node
  const nodeMatch = pattern.match(/^\s*(\([^)]*\))/);
  if (!nodeMatch) {
    throw new Error(`Cannot parse path pattern: ${pattern.substring(0, 50)}`);
  }

  const start = parseNodePattern(nodeMatch[1]);
  const rest = pattern.substring(nodeMatch[0].length).trim();

  const segments: Array<{ rel: CypherRelPattern; node: CypherNodePattern }> = [];

  if (rest.length > 0) {
    // Parse relationship + node segments
    const segmentRegex = /(<?\s*-\s*\[([^\]]*)\]\s*-\s*>?)\s*(\([^)]*\))/g;
    let segMatch;
    while ((segMatch = segmentRegex.exec(rest)) !== null) {
      const relStr = segMatch[1];
      const relContent = segMatch[2];
      const nodeStr = segMatch[3];

      const direction = relStr.startsWith('<') ? 'incoming'
        : relStr.endsWith('>') ? 'outgoing'
        : 'both';

      const rel = parseRelContent(relContent, direction);
      const node = parseNodePattern(nodeStr);
      segments.push({ rel, node });
    }
  }

  return { start, segments };
}

function parseNodePattern(str: string): CypherNodePattern {
  // (variable:Label1:Label2 {prop: value, prop2: value2})
  const inner = str.replace(/^\(\s*/, '').replace(/\s*\)$/, '');

  const propsMatch = inner.match(/\{([^}]*)\}/);
  const properties = propsMatch ? parseInlineProps(propsMatch[1]) : undefined;

  const beforeProps = propsMatch ? inner.substring(0, inner.indexOf('{')).trim() : inner.trim();

  // Split by : to get variable and labels
  const parts = beforeProps.split(':').map((p) => p.trim()).filter(Boolean);

  let variable: string | undefined;
  let labels: string[] = [];

  if (parts.length > 0) {
    // First part is variable if it starts with lowercase or is a single identifier
    if (parts.length === 1) {
      // Could be just a variable or just a label
      // Convention: if it starts with uppercase, it's a label; otherwise variable
      if (/^[a-z_]/.test(parts[0])) {
        variable = parts[0];
      } else {
        labels = [parts[0]];
      }
    } else {
      variable = parts[0] || undefined;
      labels = parts.slice(1);
    }
  }

  return { variable, labels, properties };
}

function parseRelContent(content: string, direction: 'outgoing' | 'incoming' | 'both'): CypherRelPattern {
  const trimmed = content.trim();

  const propsMatch = trimmed.match(/\{([^}]*)\}/);
  const properties = propsMatch ? parseInlineProps(propsMatch[1]) : undefined;

  const beforeProps = propsMatch ? trimmed.substring(0, trimmed.indexOf('{')).trim() : trimmed;

  // :TYPE or variable:TYPE
  const parts = beforeProps.split(':').map((p) => p.trim()).filter(Boolean);

  let variable: string | undefined;
  let type: string | undefined;

  if (parts.length === 1) {
    if (/^[A-Z_]/.test(parts[0])) {
      type = parts[0];
    } else {
      variable = parts[0];
    }
  } else if (parts.length >= 2) {
    variable = parts[0] || undefined;
    type = parts[1];
  }

  return { variable, type, direction, properties };
}

function parseRelAndNode(str: string): { rel: CypherRelPattern; node: CypherNodePattern } {
  const relMatch = str.match(/^(<?\s*-\s*\[([^\]]*)\]\s*-\s*>?)\s*(\([^)]*\))/);
  if (!relMatch) {
    throw new Error(`Cannot parse relationship segment: ${str.substring(0, 50)}`);
  }

  const relStr = relMatch[1];
  const relContent = relMatch[2];
  const nodeStr = relMatch[3];

  const direction = relStr.startsWith('<') ? 'incoming'
    : relStr.endsWith('>') ? 'outgoing'
    : 'both';

  return {
    rel: parseRelContent(relContent, direction),
    node: parseNodePattern(nodeStr),
  };
}

// ─── WHERE Parsing ─────────────────────────────────────────────────

function parseWhere(whereStr: string): CypherWhereClause {
  const conditions: CypherWhereClause['conditions'] = [];

  // Split by AND (case insensitive)
  const parts = whereStr.split(/\bAND\b/i);

  for (const part of parts) {
    const trimmed = part.trim();
    // Match: variable.property operator value
    const condMatch = trimmed.match(/^(\w+)\.(\w+)\s*(=|<>|!=|>=|<=|>|<|CONTAINS|STARTS WITH|ENDS WITH)\s*(.+)$/i);
    if (condMatch) {
      conditions.push({
        variable: condMatch[1],
        property: condMatch[2],
        operator: condMatch[3].toUpperCase(),
        value: parseValue(condMatch[4].trim()),
      });
    }
  }

  return { conditions };
}

// ─── RETURN Parsing ────────────────────────────────────────────────

function parseReturn(returnStr: string): CypherReturnClause {
  const items: CypherReturnClause['items'] = [];

  const parts = returnStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    // Check for alias: expr AS alias
    const aliasMatch = trimmed.match(/^(.+?)\s+AS\s+(\w+)$/i);
    const expr = aliasMatch ? aliasMatch[1].trim() : trimmed;
    const alias = aliasMatch ? aliasMatch[2] : undefined;

    // Check for property access: variable.property
    const propMatch = expr.match(/^(\w+)\.(\w+)$/);
    if (propMatch) {
      items.push({ variable: propMatch[1], property: propMatch[2], alias });
    } else {
      items.push({ variable: expr, alias });
    }
  }

  return { items };
}

// ─── SET Parsing ───────────────────────────────────────────────────

function parseSet(setStr: string): CypherSetClause {
  const assignments: CypherSetClause['assignments'] = [];

  const parts = setStr.split(',');
  for (const part of parts) {
    const match = part.trim().match(/^(\w+)\.(\w+)\s*=\s*(.+)$/);
    if (match) {
      assignments.push({
        variable: match[1],
        property: match[2],
        value: parseValue(match[3].trim()),
      });
    }
  }

  return { assignments };
}

// ─── Value Parsing ─────────────────────────────────────────────────

function parseValue(str: string): any {
  // String literals
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
    return str.slice(1, -1);
  }
  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return Number(str);
  }
  // Booleans
  if (str.toLowerCase() === 'true') return true;
  if (str.toLowerCase() === 'false') return false;
  // Null
  if (str.toLowerCase() === 'null') return null;

  return str;
}

function parseInlineProps(propsStr: string): Record<string, any> {
  const props: Record<string, any> = {};
  // Simple key: value pairs
  const pairs = propsStr.split(',');
  for (const pair of pairs) {
    const match = pair.trim().match(/^(\w+)\s*:\s*(.+)$/);
    if (match) {
      props[match[1]] = parseValue(match[2].trim());
    }
  }
  return props;
}

// ─── Filter Building ───────────────────────────────────────────────

/**
 * Converts WHERE conditions for a specific variable into a PropertyFilter.
 *
 * Why: Pure transformation — WHERE clause conditions become the filter
 * operators the engine already understands.
 */
export function whereToFilter(where: CypherWhereClause, variable: string): PropertyFilter | undefined {
  const filter: PropertyFilter = {};
  let hasConditions = false;

  for (const cond of where.conditions) {
    if (cond.variable !== variable) continue;
    hasConditions = true;

    switch (cond.operator) {
      case '=': filter[cond.property] = { $eq: cond.value }; break;
      case '<>':
      case '!=': filter[cond.property] = { $neq: cond.value }; break;
      case '>': filter[cond.property] = { $gt: cond.value }; break;
      case '>=': filter[cond.property] = { $gte: cond.value }; break;
      case '<': filter[cond.property] = { $lt: cond.value }; break;
      case '<=': filter[cond.property] = { $lte: cond.value }; break;
      case 'CONTAINS': filter[cond.property] = { $contains: cond.value }; break;
      case 'STARTS WITH': filter[cond.property] = { $startsWith: cond.value }; break;
      case 'ENDS WITH': filter[cond.property] = { $endsWith: cond.value }; break;
    }
  }

  return hasConditions ? filter : undefined;
}
