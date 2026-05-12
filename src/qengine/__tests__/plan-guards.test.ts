/**
 * qengine planner — fail-loud guards and adapter purity.
 *
 * Why: `plan.test.ts` covers the happy lowering paths and one unbound-
 * variable guard. The planner has four more guards (multi-MATCH,
 * multi-pattern, multi-label, unknown-operator-in-physical) and the
 * row module has a pure relationship adapter (`edgeToValue`). All
 * pinned here.
 */

import { describe, it, expect } from 'vitest';
import { toLogicalPlan } from '../plan/logical.js';
import { toPhysicalPlan } from '../plan/physical.js';
import { FailLoudError } from '../runtime/errors.js';
import { edgeToValue, nodeToValue } from '../runtime/row.js';
import type { AstQuery } from '../parser/ast.js';
import type { LogicalPlan } from '../plan/logical.js';

describe('qengine planner \u2014 fail-loud guards', () => {
  it('refuses an AST with zero MATCH clauses', () => {
    const ast: AstQuery = {
      kind: 'query',
      matches: [],
      return: { kind: 'return', items: [] },
    };
    expect(() => toLogicalPlan(ast)).toThrow(FailLoudError);
    expect(() => toLogicalPlan(ast)).toThrow(/exactly one MATCH/);
  });

  it('refuses an AST with two MATCH clauses', () => {
    const ast: AstQuery = {
      kind: 'query',
      matches: [
        { kind: 'match', patterns: [{ kind: 'nodePattern', variable: 'n', labels: ['A'] }] },
        { kind: 'match', patterns: [{ kind: 'nodePattern', variable: 'm', labels: ['B'] }] },
      ],
      return: {
        kind: 'return',
        items: [{ kind: 'returnItem', expression: { kind: 'variable', name: 'n' } }],
      },
    };
    expect(() => toLogicalPlan(ast)).toThrow(/exactly one MATCH/);
  });

  it('refuses a MATCH with zero patterns', () => {
    const ast: AstQuery = {
      kind: 'query',
      matches: [{ kind: 'match', patterns: [] }],
      return: { kind: 'return', items: [] },
    };
    expect(() => toLogicalPlan(ast)).toThrow(/exactly one node pattern/);
  });

  it('refuses a MATCH with two node patterns', () => {
    const ast: AstQuery = {
      kind: 'query',
      matches: [
        {
          kind: 'match',
          patterns: [
            { kind: 'nodePattern', variable: 'n', labels: ['A'] },
            { kind: 'nodePattern', variable: 'm', labels: ['B'] },
          ],
        },
      ],
      return: {
        kind: 'return',
        items: [{ kind: 'returnItem', expression: { kind: 'variable', name: 'n' } }],
      },
    };
    expect(() => toLogicalPlan(ast)).toThrow(/exactly one node pattern/);
  });

  it('refuses a pattern with zero labels', () => {
    const ast: AstQuery = {
      kind: 'query',
      matches: [{ kind: 'match', patterns: [{ kind: 'nodePattern', variable: 'n', labels: [] }] }],
      return: {
        kind: 'return',
        items: [{ kind: 'returnItem', expression: { kind: 'variable', name: 'n' } }],
      },
    };
    expect(() => toLogicalPlan(ast)).toThrow(/exactly one label per pattern/);
  });

  it('refuses a pattern with two labels', () => {
    const ast: AstQuery = {
      kind: 'query',
      matches: [
        {
          kind: 'match',
          patterns: [{ kind: 'nodePattern', variable: 'n', labels: ['A', 'B'] }],
        },
      ],
      return: {
        kind: 'return',
        items: [{ kind: 'returnItem', expression: { kind: 'variable', name: 'n' } }],
      },
    };
    expect(() => toLogicalPlan(ast)).toThrow(/exactly one label per pattern/);
  });
});

describe('qengine physical planner \u2014 exhaustiveness', () => {
  it('throws FailLoudError on an unknown logical operator (defensive)', () => {
    // Forge a logical plan with a kind the physical planner doesn't
    // know about. This exercises the exhaustiveness/default branch
    // that's marked as unreachable but exists as a runtime guard.
    const rogue = { kind: 'NotARealOp', payload: {} } as unknown as LogicalPlan;
    expect(() => toPhysicalPlan(rogue, {})).toThrow(FailLoudError);
    expect(() => toPhysicalPlan(rogue, {})).toThrow(/unknown logical operator/);
  });
});

describe('qengine runtime/row \u2014 adapter purity', () => {
  it('nodeToValue copies labels and properties (no aliasing)', () => {
    const labels = ['Twin'];
    const properties = { name: 'Ada', tags: ['a', 'b'] };
    const node = { id: 'n1', labels, properties };
    const out = nodeToValue(node);
    expect(out).toEqual({
      kind: 'node',
      id: 'n1',
      labels: ['Twin'],
      properties: { name: 'Ada', tags: ['a', 'b'] },
    });
    // The labels array is a copy \u2014 mutating it must not mutate the input.
    out.labels.push('Extra');
    expect(labels).toEqual(['Twin']);
    // The properties object is a shallow copy.
    out.properties.name = 'Lin';
    expect(properties.name).toBe('Ada');
  });

  it('edgeToValue maps a Relationship to a public EdgeValue', () => {
    const rel = {
      id: 'r1',
      type: 'KNOWS',
      startNode: 'a',
      endNode: 'b',
      properties: { since: 2026, weight: 0.7 },
    };
    const out = edgeToValue(rel);
    expect(out).toEqual({
      kind: 'edge',
      id: 'r1',
      type: 'KNOWS',
      startNode: 'a',
      endNode: 'b',
      properties: { since: 2026, weight: 0.7 },
    });
    // Properties are a shallow copy.
    out.properties.since = 9999;
    expect(rel.properties.since).toBe(2026);
  });
});
