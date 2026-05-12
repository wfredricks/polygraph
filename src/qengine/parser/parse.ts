/**
 * qengine parser — cypher string -> AST for the v0 slice.
 *
 * Why: A real openCypher parser is the long-term answer (ANTLR4 grammar
 * via `antlr4ts`), but for the v0 slice we need exactly one production:
 *
 *     MATCH (variable:Label) RETURN variable
 *
 * Hand-rolling that takes ~80 lines of code with zero new dependencies
 * — preserving Decision #16 (pure TypeScript, government-authorizable)
 * — while still emitting the same AST a future ANTLR walker will
 * produce. When the next slice (WHERE / parameters / property access)
 * needs more grammar than we want to maintain by hand, we replace this
 * file alone; everything downstream of the AST stays.
 *
 * The parser is deliberately strict. Anything outside the slice — an
 * edge pattern, a WHERE clause, a property projection — throws a
 * `FailLoudError`. We chose loud refusal over silent best-effort
 * because the regex bridge spent half of 2026-04 hiding bugs behind
 * empty result sets, and Decision #19 makes that the one habit we are
 * never repeating.
 *
 * @tier polygraph
 * @capability qengine.parser
 * @style pure
 */

import type {
  AstExpression,
  AstMatch,
  AstNodePattern,
  AstQuery,
  AstReturn,
  AstReturnItem,
} from './ast.js';
import { FailLoudError } from '../runtime/errors.js';

// ─── Tokeniser ─────────────────────────────────────────────────────

type TokenKind =
  | 'KEYWORD' // MATCH, RETURN, AS
  | 'IDENT' // n, Twin, ...
  | 'LPAREN'
  | 'RPAREN'
  | 'COLON'
  | 'COMMA'
  | 'EOF';

interface Token {
  kind: TokenKind;
  value: string;
  /** 1-based character index in the source, for error messages. */
  pos: number;
}

/** Reserved words v0 recognises. Case-insensitive in source, canonical here. */
const KEYWORDS = new Set(['MATCH', 'RETURN', 'AS']);

/**
 * Characters that, if they appear in the source, signal a feature we
 * intentionally do not support in v0. Catching them at the tokeniser
 * gives us a precise refusal message ("not supported in v0: edge
 * patterns") rather than a generic parse failure deep in the grammar.
 */
const UNSUPPORTED_CHARS: Record<string, string> = {
  '[': 'edge patterns (e.g. -[r]->)',
  ']': 'edge patterns (e.g. -[r]->)',
  '-': 'edge patterns (e.g. -[r]->)',
  '<': 'edge patterns (incoming arrows)',
  '>': 'edge patterns or comparison operators',
  '{': 'inline property maps (e.g. {id: $x})',
  '}': 'inline property maps (e.g. {id: $x})',
  '$': 'parameters',
  '.': 'property access (e.g. n.prop)',
  '=': 'WHERE / SET clauses',
  '*': 'variable-length paths',
};

function tokenise(cypher: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < cypher.length) {
    const ch = cypher[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Punctuation
    if (ch === '(') { tokens.push({ kind: 'LPAREN', value: '(', pos: i + 1 }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'RPAREN', value: ')', pos: i + 1 }); i++; continue; }
    if (ch === ':') { tokens.push({ kind: 'COLON', value: ':', pos: i + 1 }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'COMMA', value: ',', pos: i + 1 }); i++; continue; }

    // Identifiers / keywords
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < cypher.length && /[A-Za-z0-9_]/.test(cypher[i])) i++;
      const value = cypher.slice(start, i);
      const upper = value.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ kind: 'KEYWORD', value: upper, pos: start + 1 });
      } else {
        tokens.push({ kind: 'IDENT', value, pos: start + 1 });
      }
      continue;
    }

    // Loud refusal for known-unsupported characters
    if (ch in UNSUPPORTED_CHARS) {
      throw new FailLoudError(
        cypher,
        `not supported in v0: ${UNSUPPORTED_CHARS[ch]} (found '${ch}' at position ${i + 1})`,
      );
    }

    throw new FailLoudError(
      cypher,
      `unexpected character '${ch}' at position ${i + 1}`,
    );
  }

  tokens.push({ kind: 'EOF', value: '', pos: cypher.length + 1 });
  return tokens;
}

// ─── Recursive descent parser ──────────────────────────────────────

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly source: string) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  private expect(kind: TokenKind, value?: string): Token {
    const tok = this.peek();
    if (tok.kind !== kind || (value !== undefined && tok.value !== value)) {
      const want = value ? `${kind}(${value})` : kind;
      throw new FailLoudError(
        this.source,
        `expected ${want} at position ${tok.pos}, got ${tok.kind}('${tok.value}')`,
      );
    }
    return this.advance();
  }

  parseQuery(): AstQuery {
    const matches: AstMatch[] = [this.parseMatch()];
    const ret = this.parseReturn();
    if (this.peek().kind !== 'EOF') {
      const tok = this.peek();
      throw new FailLoudError(
        this.source,
        `unexpected trailing input at position ${tok.pos}: '${tok.value}' (v0 supports only MATCH ... RETURN ...)`,
      );
    }
    return { kind: 'query', matches, return: ret };
  }

  private parseMatch(): AstMatch {
    this.expect('KEYWORD', 'MATCH');
    const pattern = this.parseNodePattern();
    return { kind: 'match', patterns: [pattern] };
  }

  private parseNodePattern(): AstNodePattern {
    this.expect('LPAREN');
    const variable = this.expect('IDENT').value;
    this.expect('COLON');
    const label = this.expect('IDENT').value;
    this.expect('RPAREN');
    return { kind: 'nodePattern', variable, labels: [label] };
  }

  private parseReturn(): AstReturn {
    this.expect('KEYWORD', 'RETURN');
    const items: AstReturnItem[] = [this.parseReturnItem()];
    // v0 supports a single RETURN item. Multiple comma-separated items
    // become a clear "not in v0" refusal — see the loud branch below.
    if (this.peek().kind === 'COMMA') {
      throw new FailLoudError(
        this.source,
        'not supported in v0: multiple RETURN items (use a single bare variable)',
      );
    }
    return { kind: 'return', items };
  }

  private parseReturnItem(): AstReturnItem {
    const expression: AstExpression = {
      kind: 'variable',
      name: this.expect('IDENT').value,
    };
    let alias: string | undefined;
    if (this.peek().kind === 'KEYWORD' && this.peek().value === 'AS') {
      this.advance();
      alias = this.expect('IDENT').value;
    }
    return { kind: 'returnItem', expression, alias };
  }
}

/**
 * Parse a v0-slice cypher string.
 *
 * Accepts: `MATCH (var:Label) RETURN var [AS alias]` with arbitrary
 * whitespace and case-insensitive keywords. Anything else throws
 * `FailLoudError` with a diagnosis.
 */
export function parse(cypher: string): AstQuery {
  if (typeof cypher !== 'string' || cypher.trim().length === 0) {
    throw new FailLoudError(cypher ?? '', 'empty query');
  }
  const tokens = tokenise(cypher);
  return new Parser(tokens, cypher).parseQuery();
}
