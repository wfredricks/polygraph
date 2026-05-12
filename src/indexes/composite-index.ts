/**
 * Composite index — `Map<Label, Map<compositeKey, Set<NodeId>>>`.
 *
 * Why: For the user-scoped query pattern `MATCH (t:Twin) WHERE
 * t.userId = $u`, the property index on `(Twin, userId)` already gives
 * us the right answer. The composite is a parallel, dedicated path
 * keyed by `(label, [property...])` that uses a single Map.get rather
 * than (label, prop) → (value → ids). For single-property composites
 * the savings are an indirection level; for multi-property composites
 * (later) it avoids set-intersection in the common case.
 *
 * We pack composite values into a single key string with a private
 * separator so the lookup is a single Map.get. Indexable scalars only;
 * if any of the composite's properties on a given node aren't an
 * indexable primitive, that node is *not* added to the composite (and
 * the caller — who must already know to fall back — can't see a wrong
 * answer, only a missing one). This is the same null-vs-empty contract
 * the property index uses.
 *
 * @tier polygraph
 * @capability indexes.composite
 */

import type { NodeId } from '../types.js';
import {
  COMPOSITES_BY_LABEL,
  COMPOSITE_INDEXES,
  compositeIndexKey,
  type CompositeIndexSpec,
} from './config.js';
import { toIndexable, type NodeSlice, type ReadableIndex } from './types.js';

/** Separator inside the composite-value key. Not allowed in indexable values. */
const VALUE_SEP = '\u0003';

export class CompositeIndex implements ReadableIndex {
  /** outer key = `Label\u0001p1\u0002p2…` → inner key = `v1\u0003v2…` → NodeIds. */
  private byKey: Map<string, Map<string, Set<NodeId>>> = new Map();

  size(): number {
    return this.byKey.size;
  }

  /** True iff `(label, [property...])` matches a configured composite. */
  static isIndexed(label: string, properties: readonly string[]): boolean {
    const specs = COMPOSITES_BY_LABEL.get(label);
    if (!specs) return false;
    return specs.some((s) => sameProps(s.properties, properties));
  }

  /** Insert a node into every composite whose label/properties match. */
  add(node: NodeSlice): void {
    for (const label of node.labels) {
      const specs = COMPOSITES_BY_LABEL.get(label);
      if (!specs) continue;
      for (const spec of specs) {
        const valueKey = composeValue(node, spec);
        if (valueKey === null) continue;
        this.put(spec, valueKey, node.id);
      }
    }
  }

  /** Remove a node, using the property values it currently holds. */
  remove(node: NodeSlice): void {
    for (const label of node.labels) {
      const specs = COMPOSITES_BY_LABEL.get(label);
      if (!specs) continue;
      for (const spec of specs) {
        const valueKey = composeValue(node, spec);
        if (valueKey === null) continue;
        this.del(spec, valueKey, node.id);
      }
    }
  }

  /**
   * Reflect a property change. We need the *old* node slice (or at
   * least the old value) to figure out which composite cell to vacate.
   * Engine wraps this in a helper that snapshots the node before write.
   */
  update(label: string, oldNode: NodeSlice, newNode: NodeSlice): void {
    const specs = COMPOSITES_BY_LABEL.get(label);
    if (!specs) return;
    for (const spec of specs) {
      const oldKey = composeValue(oldNode, spec);
      const newKey = composeValue(newNode, spec);
      if (oldKey === newKey) continue;
      if (oldKey !== null) this.del(spec, oldKey, oldNode.id);
      if (newKey !== null) this.put(spec, newKey, newNode.id);
    }
  }

  /**
   * Lookup nodes matching `(label, properties) = values` (in declared order).
   *
   * Returns `null` if no composite covers this `(label, properties)`
   * tuple — caller falls back to a scan. Returns an empty Set if
   * indexed but zero matches.
   */
  lookup(
    label: string,
    properties: readonly string[],
    values: readonly unknown[],
  ): ReadonlySet<NodeId> | null {
    if (properties.length !== values.length) return null;
    const specs = COMPOSITES_BY_LABEL.get(label);
    if (!specs) return null;
    const spec = specs.find((s) => sameProps(s.properties, properties));
    if (!spec) return null;
    const indexableValues: string[] = [];
    for (const v of values) {
      const ix = toIndexable(v);
      if (ix === null) return EMPTY;
      indexableValues.push(String(ix));
    }
    const outer = this.byKey.get(compositeIndexKey(spec.label, spec.properties));
    if (!outer) return EMPTY;
    return outer.get(indexableValues.join(VALUE_SEP)) ?? EMPTY;
  }

  /** Reflect that a node gained a label, indexing it under matching composites. */
  onLabelAdded(node: NodeSlice, label: string): void {
    const specs = COMPOSITES_BY_LABEL.get(label);
    if (!specs) return;
    for (const spec of specs) {
      const valueKey = composeValue(node, spec);
      if (valueKey === null) continue;
      this.put(spec, valueKey, node.id);
    }
  }

  /** Reflect that a node lost a label, removing it from matching composites. */
  onLabelRemoved(node: NodeSlice, label: string): void {
    const specs = COMPOSITES_BY_LABEL.get(label);
    if (!specs) return;
    for (const spec of specs) {
      const valueKey = composeValue(node, spec);
      if (valueKey === null) continue;
      this.del(spec, valueKey, node.id);
    }
  }

  /** All configured composites (for diagnostics / tests). */
  configured(): readonly CompositeIndexSpec[] {
    return COMPOSITE_INDEXES;
  }

  /** Drop all entries. Used by rebuild. */
  clear(): void {
    this.byKey.clear();
  }

  // ─── Private ────────────────────────────────────────────────────

  private put(spec: CompositeIndexSpec, valueKey: string, nodeId: NodeId): void {
    const outerKey = compositeIndexKey(spec.label, spec.properties);
    let outer = this.byKey.get(outerKey);
    if (!outer) {
      outer = new Map();
      this.byKey.set(outerKey, outer);
    }
    let bucket = outer.get(valueKey);
    if (!bucket) {
      bucket = new Set();
      outer.set(valueKey, bucket);
    }
    bucket.add(nodeId);
  }

  private del(spec: CompositeIndexSpec, valueKey: string, nodeId: NodeId): void {
    const outerKey = compositeIndexKey(spec.label, spec.properties);
    const outer = this.byKey.get(outerKey);
    if (!outer) return;
    const bucket = outer.get(valueKey);
    if (!bucket) return;
    bucket.delete(nodeId);
    if (bucket.size === 0) {
      outer.delete(valueKey);
      if (outer.size === 0) this.byKey.delete(outerKey);
    }
  }
}

const EMPTY: ReadonlySet<NodeId> = new Set();

/**
 * Build the value-side key for a composite, or `null` if any property
 * is missing / non-indexable. `null` means "this node does not appear
 * in this composite right now."
 */
function composeValue(node: NodeSlice, spec: CompositeIndexSpec): string | null {
  const parts: string[] = [];
  for (const prop of spec.properties) {
    const ix = toIndexable(node.properties[prop]);
    if (ix === null) return null;
    parts.push(String(ix));
  }
  return parts.join(VALUE_SEP);
}

function sameProps(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
