/**
 * Tests for qengine v0 parser.
 *
 * Why: Pins the contract for `MATCH (n:Label) RETURN n` — what is
 * accepted, what is refused, and the *shape* of the AST consumers
 * downstream (planner, executor) depend on. Every supported variation
 * gets one case; every refusal we want to surface to users gets one
 * negative case.
 *
 * @requirement REQ-QENGINE-PARSE-01..10
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parse.js';
import { FailLoudError } from '../runtime/errors.js';

describe('qengine v0 parser — MATCH (n:Label) RETURN n', () => {
  it('parses the canonical form into a stable AST', () => {
    const ast = parse('MATCH (n:Twin) RETURN n');
    expect(ast).toEqual({
      kind: 'query',
      matches: [
        {
          kind: 'match',
          patterns: [
            { kind: 'nodePattern', variable: 'n', labels: ['Twin'] },
          ],
        },
      ],
      return: {
        kind: 'return',
        items: [
          {
            kind: 'returnItem',
            expression: { kind: 'variable', name: 'n' },
            alias: undefined,
          },
        ],
      },
    });
  });

  it('tolerates arbitrary whitespace inside and between clauses', () => {
    const ast = parse('  MATCH   (   n   :   Twin   )   RETURN   n  ');
    expect(ast.matches[0].patterns[0]).toEqual({
      kind: 'nodePattern',
      variable: 'n',
      labels: ['Twin'],
    });
    expect(ast.return.items[0].expression).toEqual({
      kind: 'variable',
      name: 'n',
    });
  });

  it('is case-insensitive for keywords', () => {
    const ast = parse('match (n:Twin) return n');
    expect(ast.matches).toHaveLength(1);
    expect(ast.return.items).toHaveLength(1);
  });

  it('accepts mixed-case keywords', () => {
    const ast = parse('Match (n:Twin) Return n');
    expect(ast.matches).toHaveLength(1);
  });

  it('captures multi-character variable names and PascalCase labels', () => {
    const ast = parse('MATCH (twin:CodifiedAlgorithm) RETURN twin');
    expect(ast.matches[0].patterns[0]).toEqual({
      kind: 'nodePattern',
      variable: 'twin',
      labels: ['CodifiedAlgorithm'],
    });
    expect(ast.return.items[0].expression).toEqual({
      kind: 'variable',
      name: 'twin',
    });
  });

  it('parses an explicit alias on the RETURN item', () => {
    const ast = parse('MATCH (n:Twin) RETURN n AS twin');
    expect(ast.return.items[0].alias).toBe('twin');
  });

  it('throws FailLoudError for an empty query', () => {
    expect(() => parse('')).toThrow(FailLoudError);
    expect(() => parse('   ')).toThrow(/empty query/);
  });

  it('refuses edge patterns with a precise diagnosis', () => {
    expect(() => parse('MATCH (n:Twin)-[r:KNOWS]->(m:Twin) RETURN n')).toThrow(
      /not supported in v0: edge patterns/i,
    );
  });

  it('refuses WHERE clauses (no comparison operators in v0)', () => {
    expect(() => parse('MATCH (n:Twin) WHERE n.id = "x" RETURN n')).toThrow(
      FailLoudError,
    );
  });

  it('refuses inline property maps', () => {
    expect(() => parse('MATCH (n:Twin {id: "abc"}) RETURN n')).toThrow(
      /not supported in v0: inline property maps/i,
    );
  });

  it('refuses parameters', () => {
    expect(() => parse('MATCH (n:Twin) RETURN $x')).toThrow(
      /not supported in v0: parameters/i,
    );
  });

  it('refuses property projection (RETURN n.prop)', () => {
    expect(() => parse('MATCH (n:Twin) RETURN n.id')).toThrow(
      /not supported in v0: property access/i,
    );
  });

  it('refuses missing label after the colon', () => {
    expect(() => parse('MATCH (n) RETURN n')).toThrow(FailLoudError);
  });

  it('refuses multiple RETURN items', () => {
    // We can't easily get past the tokeniser for `RETURN n, m` since
    // `,` is allowed but two bare items in a row trip the v0 check.
    expect(() => parse('MATCH (n:Twin) RETURN n, m')).toThrow(
      /multiple RETURN items/i,
    );
  });

  it('refuses trailing unknown tokens', () => {
    expect(() => parse('MATCH (n:Twin) RETURN n EXTRA')).toThrow(
      /trailing input/i,
    );
  });
});
