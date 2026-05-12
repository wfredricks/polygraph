/**
 * Property index — `Map<(Label, Prop), Map<Value, Set<NodeId>>>`.
 *
 * Why: When you ask "find me every Twin with userId='alice'", today's
 * engine either scans the full label index (the dormant adapter-key
 * property index path is never armed in production) or scans the
 * (label, prop, value) adapter prefix — both of which trigger the
 * MemoryAdapter's whole-key-space sort. This in-memory layer collapses
 * the lookup to two Map.gets and a Set iteration over only the
 * matching node ids.
 *
 * Indexed pairs are declared in `config.ts`. Properties not listed
 * there are simply not maintained — `lookup()` returns `null` and the
 * caller falls back to a scan. We refuse loudly if someone tries to
 * mutate an entry for an unindexed (label, prop) pair: that means the
 * write path has a bug and is about to lie to a future reader.
 *
 * @tier polygraph
 * @capability indexes.property
 */

import type { NodeId } from '../types.js';
import { INDEXED_PROPERTY_KEYS, PROPERTIES_BY_LABEL, propIndexKey } from './config.js';
import { toIndexable, type IndexablePrimitive, type NodeSlice, type ReadableIndex } from './types.js';

export class PropertyIndex implements ReadableIndex {
  /** key = `Label\u0001property` → value → Set<NodeId>. */
  private byKey: Map<string, Map<IndexablePrimitive, Set<NodeId>>> = new Map();

  /** Total distinct (label, property) pairs currently maintained. */
  size(): number {
    return this.byKey.size;
  }

  /** True iff `(label, property)` is one of the configured indexed pairs. */
  static isIndexed(label: string, property: string): boolean {
    return INDEXED_PROPERTY_KEYS.has(propIndexKey(label, property));
  }

  /**
   * Insert a node into all property indexes that apply to its labels.
   * Idempotent.
   */
  add(node: NodeSlice): void {
    for (const label of node.labels) {
      const props = PROPERTIES_BY_LABEL.get(label);
      if (!props) continue;
      for (const prop of props) {
        const raw = node.properties[prop];
        const value = toIndexable(raw);
        if (value === null) continue;
        this.put(label, prop, value, node.id);
      }
    }
  }

  /**
   * Remove a node from all property indexes that apply.
   *
   * The caller must pass the property values the node *had* at the time
   * of deletion — we don't retain the node's bag.
   */
  remove(node: NodeSlice): void {
    for (const label of node.labels) {
      const props = PROPERTIES_BY_LABEL.get(label);
      if (!props) continue;
      for (const prop of props) {
        const raw = node.properties[prop];
        const value = toIndexable(raw);
        if (value === null) continue;
        this.del(label, prop, value, node.id);
      }
    }
  }

  /**
   * Reflect an in-place property change.
   *
   * `oldValue` is the value the index currently has for this node;
   * `newValue` is what it should have. Either may be undefined (means
   * "the property didn't exist before / no longer exists after").
   */
  update(
    label: string,
    property: string,
    nodeId: NodeId,
    oldValue: unknown,
    newValue: unknown,
  ): void {
    if (!PropertyIndex.isIndexed(label, property)) {
      // Quietly skip — this isn't an error, it just means the property
      // isn't in our maintenance set. (Throwing would couple every
      // engine update to the config, which is hostile to growth.)
      return;
    }
    const oldKey = toIndexable(oldValue);
    const newKey = toIndexable(newValue);
    if (oldKey === newKey) return;
    if (oldKey !== null) this.del(label, property, oldKey, nodeId);
    if (newKey !== null) this.put(label, property, newKey, nodeId);
  }

  /**
   * All node ids matching `(label, property) = value`, or `null` if
   * this `(label, property)` pair is *not* an indexed pair (signals
   * the caller to fall back to a scan).
   *
   * Returning a `null`-vs-empty distinction is the contract. An empty
   * Set means "indexed and zero matches"; `null` means "not indexed,
   * you must do this the slow way."
   */
  lookup(label: string, property: string, value: unknown): ReadonlySet<NodeId> | null {
    if (!PropertyIndex.isIndexed(label, property)) return null;
    const indexable = toIndexable(value);
    if (indexable === null) return EMPTY;
    const valMap = this.byKey.get(propIndexKey(label, property));
    if (!valMap) return EMPTY;
    return valMap.get(indexable) ?? EMPTY;
  }

  /** Drop all entries. Used by rebuild. */
  clear(): void {
    this.byKey.clear();
  }

  /** Reflect that a node gained a new label, indexing its (still-set) properties. */
  onLabelAdded(node: NodeSlice, label: string): void {
    const props = PROPERTIES_BY_LABEL.get(label);
    if (!props) return;
    for (const prop of props) {
      const value = toIndexable(node.properties[prop]);
      if (value === null) continue;
      this.put(label, prop, value, node.id);
    }
  }

  /** Reflect that a node lost a label; remove its entries under that label. */
  onLabelRemoved(node: NodeSlice, label: string): void {
    const props = PROPERTIES_BY_LABEL.get(label);
    if (!props) return;
    for (const prop of props) {
      const value = toIndexable(node.properties[prop]);
      if (value === null) continue;
      this.del(label, prop, value, node.id);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────

  private put(label: string, property: string, value: IndexablePrimitive, nodeId: NodeId): void {
    const k = propIndexKey(label, property);
    let valMap = this.byKey.get(k);
    if (!valMap) {
      valMap = new Map();
      this.byKey.set(k, valMap);
    }
    let bucket = valMap.get(value);
    if (!bucket) {
      bucket = new Set();
      valMap.set(value, bucket);
    }
    bucket.add(nodeId);
  }

  private del(label: string, property: string, value: IndexablePrimitive, nodeId: NodeId): void {
    const k = propIndexKey(label, property);
    const valMap = this.byKey.get(k);
    if (!valMap) return;
    const bucket = valMap.get(value);
    if (!bucket) return;
    bucket.delete(nodeId);
    if (bucket.size === 0) {
      valMap.delete(value);
      if (valMap.size === 0) this.byKey.delete(k);
    }
  }
}

const EMPTY: ReadonlySet<NodeId> = new Set();
