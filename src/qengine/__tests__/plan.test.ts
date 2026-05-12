/**
 * Tests for qengine v0 planner (logical + physical).
 *
 * Why: Pins the plan shapes the executor depends on, and guards the
 * fail-loud refusals at the planning boundary.
 *
 * @requirement REQ-QENGINE-PLAN-01..06
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parse.js';
import { toLogicalPlan } from '../plan/logical.js';
import { toPhysicalPlan } from '../plan/physical.js';
import { FailLoudError } from '../runtime/errors.js';
import type { AstQuery } from '../parser/ast.js';

describe('qengine v0 logical plan', () => {
  it('lowers MATCH (n:Twin) RETURN n into Project(NodeScan)', () => {
    const ast = parse('MATCH (n:Twin) RETURN n');
    const plan = toLogicalPlan(ast);
    expect(plan).toEqual({
      kind: 'Project',
      expressions: [{ variable: 'n', alias: 'n' }],
      input: { kind: 'NodeScan', variable: 'n', label: 'Twin' },
    });
  });

  it('uses the RETURN alias when one is given', () => {
    const ast = parse('MATCH (n:Twin) RETURN n AS twin');
    const plan = toLogicalPlan(ast);
    if (plan.kind !== 'Project') throw new Error('expected Project root');
    expect(plan.expressions[0]).toEqual({ variable: 'n', alias: 'twin' });
  });

  it('refuses RETURN of an unbound variable', () => {
    // Hand-build an AST that bypasses the parser to test planner guards.
    const ast: AstQuery = {
      kind: 'query',
      matches: [{ kind: 'match', patterns: [{ kind: 'nodePattern', variable: 'n', labels: ['Twin'] }] }],
      return: {
        kind: 'return',
        items: [{ kind: 'returnItem', expression: { kind: 'variable', name: 'x' } }],
      },
    };
    expect(() => toLogicalPlan(ast)).toThrow(FailLoudError);
  });
});

describe('qengine v0 physical plan', () => {
  it('lowers NodeScan into LabelScan, Project into Project', () => {
    const ast = parse('MATCH (n:Twin) RETURN n');
    const logical = toLogicalPlan(ast);
    const physical = toPhysicalPlan(logical, {});
    expect(physical).toEqual({
      kind: 'Project',
      expressions: [{ variable: 'n', alias: 'n' }],
      input: { kind: 'LabelScan', variable: 'n', label: 'Twin' },
    });
  });

  it('threads aliases through to the physical plan', () => {
    const physical = toPhysicalPlan(
      toLogicalPlan(parse('MATCH (n:Twin) RETURN n AS twin')),
      {},
    );
    if (physical.kind !== 'Project') throw new Error('expected Project root');
    expect(physical.expressions[0]).toEqual({ variable: 'n', alias: 'twin' });
  });

  it('accepts an empty stats object (v0 placeholder)', () => {
    // The signature stability matters more than the field — call sites
    // will eventually pass real stats. Sanity-check that {} is fine.
    const ast = parse('MATCH (n:Twin) RETURN n');
    expect(() => toPhysicalPlan(toLogicalPlan(ast), {})).not.toThrow();
  });
});
