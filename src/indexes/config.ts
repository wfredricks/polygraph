/**
 * Declarative index configuration.
 *
 * Why: We deliberately do NOT auto-index every property. Indexing
 * everything is expensive on writes and rarely the right answer in a
 * twin/animator workload where each label has 5–15 properties and we
 * filter on the same 1–2 of them. Listing the indexed pairs here also
 * makes it impossible to "accidentally rely on" an index that isn't
 * being maintained — if a (label, prop) pair is missing from this file,
 * `PropertyIndex.lookup()` returns null and callers fall back to a
 * label scan + JS filter.
 *
 * To add a new index: add the entry here. The next `PolyGraph.open()`
 * rebuilds from the node store and the index is live.
 *
 * @tier polygraph
 * @capability indexes.config
 */

/** (Label, Property) pairs we maintain a value→nodeIds index for. */
export interface PropertyIndexSpec {
  readonly label: string;
  readonly property: string;
}

/** (Label, [Property, ...]) tuples we maintain a composite-value→nodeIds index for. */
export interface CompositeIndexSpec {
  readonly label: string;
  readonly properties: readonly string[];
}

/**
 * Indexed equality lookups. Everything else falls back to label scan + JS filter.
 *
 * Why these: each one is on the hot path of a real production query.
 * - Twin.userId, Twin.twinType, Twin.id — `loadRosterFromGraph`, animator
 *   idempotency checks, twin↔node hydration.
 * - Document.id / Document.userId — document fetch by id, user's document set.
 * - Opportunity.id — opportunity hydration by id.
 * - Conversation.userId, Persona.userId — user-scoped contextual loads.
 */
export const INDEXED_PROPERTIES: readonly PropertyIndexSpec[] = [
  { label: 'Twin', property: 'userId' },
  { label: 'Twin', property: 'twinType' },
  { label: 'Twin', property: 'id' },
  { label: 'Document', property: 'id' },
  { label: 'Document', property: 'userId' },
  { label: 'Opportunity', property: 'id' },
  { label: 'Conversation', property: 'userId' },
  { label: 'Persona', property: 'userId' },
] as const;

/**
 * Composite (label, [property, ...]) indexes.
 *
 * Why these specifically: every user-scoped query in the animator runs
 * "find me the Twins / Documents for user X". The single-prop index on
 * `userId` already covers this case correctly, but a dedicated composite
 * index trims an extra Map indirection. We'll measure whether it's
 * worth keeping as a separate code path.
 */
export const COMPOSITE_INDEXES: readonly CompositeIndexSpec[] = [
  { label: 'Twin', properties: ['userId'] },
  { label: 'Document', properties: ['userId'] },
] as const;

// ─── Helpers for fast lookup keys ──────────────────────────────────

/** Key for the property-index map: `Label\u0001property`. */
export function propIndexKey(label: string, property: string): string {
  return `${label}\u0001${property}`;
}

/** Key for the composite-index map: `Label\u0001p1\u0002p2…`. */
export function compositeIndexKey(label: string, properties: readonly string[]): string {
  return `${label}\u0001${properties.join('\u0002')}`;
}

/**
 * The set of indexed (label, property) pairs, for O(1) "is this indexed?" checks.
 * Computed once at module load.
 */
export const INDEXED_PROPERTY_KEYS: ReadonlySet<string> = new Set(
  INDEXED_PROPERTIES.map((s) => propIndexKey(s.label, s.property)),
);

/** Map from label -> properties to maintain on that label, for fast write-path branching. */
export const PROPERTIES_BY_LABEL: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const spec of INDEXED_PROPERTIES) {
    const list = m.get(spec.label) ?? [];
    list.push(spec.property);
    m.set(spec.label, list);
  }
  return m;
})();

/** Map from label -> composite specs that apply, for fast write-path branching. */
export const COMPOSITES_BY_LABEL: ReadonlyMap<string, readonly CompositeIndexSpec[]> = (() => {
  const m = new Map<string, CompositeIndexSpec[]>();
  for (const spec of COMPOSITE_INDEXES) {
    const list = m.get(spec.label) ?? [];
    list.push(spec);
    m.set(spec.label, list);
  }
  return m;
})();
