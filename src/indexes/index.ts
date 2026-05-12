/**
 * In-memory index orchestrator for PolyGraph.
 *
 * Why: One class to hold the four indexes and one entry point to
 * rebuild them from the node store on `PolyGraph.open()`. Keeping the
 * orchestrator separate from the engine means engine code only sees
 * `indexes.label.lookup(label)` etc. — no Map-of-Map indirection in
 * the hot path of every read.
 *
 * Lifecycle:
 *   1. `new IndexManager()`            — empty.
 *   2. `applyNodeCreated(node)`        — on every write.
 *   3. `applyNodeDeleted(node)`        — on every delete.
 *   4. `applyNodeUpdated(old, new)`    — on every property write.
 *   5. `rebuildFromStreams(...)`       — walks the node + edge stores
 *                                        once on startup.
 *
 * The methods are synchronous because the indexes are in-memory; the
 * engine awaits its adapter writes first, then commits the index
 * mutation synchronously before returning. This keeps the invariant
 * "index reflects the most-recently-persisted state" easy to reason
 * about.
 *
 * @tier polygraph
 * @capability indexes.manager
 */

import type { Node, NodeId, Relationship } from '../types.js';
import { LabelIndex } from './label-index.js';
import { PropertyIndex } from './property-index.js';
import { AdjacencyIndex } from './adjacency-index.js';
import { CompositeIndex } from './composite-index.js';
import { asNodeSlice, asRelSlice, type NodeSlice } from './types.js';

export interface IndexStats {
  labelCount: number;
  nodeCount: number;
  propertyIndexCount: number;
  adjacencyNodeCount: number;
  compositeIndexCount: number;
}

export class IndexManager {
  readonly label = new LabelIndex();
  readonly property = new PropertyIndex();
  readonly adjacency = new AdjacencyIndex();
  readonly composite = new CompositeIndex();

  /** Called on every successful node create. */
  applyNodeCreated(node: Node): void {
    const slice = asNodeSlice(node);
    this.label.add(slice);
    this.property.add(slice);
    this.adjacency.ensureNode(slice.id);
    this.composite.add(slice);
  }

  /**
   * Called on every successful node delete. `node` is the snapshot
   * read *before* the delete — we need its properties + labels to
   * vacate the right index cells.
   */
  applyNodeDeleted(node: Node): void {
    const slice = asNodeSlice(node);
    this.label.remove(slice.id, slice.labels);
    this.property.remove(slice);
    this.adjacency.forgetNode(slice.id);
    this.composite.remove(slice);
  }

  /**
   * Called on every successful node update (property merge).
   *
   * `before` is the node as it was *before* the merge; `after` is the
   * node as it is *after*. The engine must pass both; we don't try to
   * be clever and infer one from the other.
   */
  applyNodeUpdated(before: Node, after: Node): void {
    const oldSlice = asNodeSlice(before);
    const newSlice = asNodeSlice(after);

    // For each indexed (label, prop) on each shared label, diff old/new.
    for (const label of newSlice.labels) {
      // Properties index
      // The per-label indexed props are encapsulated in PropertyIndex.update;
      // we iterate the union of old/new keys so a *removed* property also
      // vacates its index cell. (Today's API merges and doesn't remove, but
      // we want the index to be ready when that changes.)
      const oldProps = oldSlice.properties;
      const newProps = newSlice.properties;
      const keys = new Set<string>([...Object.keys(oldProps), ...Object.keys(newProps)]);
      for (const k of keys) {
        if (!PropertyIndex.isIndexed(label, k)) continue;
        if (oldProps[k] === newProps[k]) continue;
        this.property.update(label, k, newSlice.id, oldProps[k], newProps[k]);
      }
      // Composite index update — re-evaluate every composite for this label.
      this.composite.update(label, oldSlice, newSlice);
    }
  }

  /** Called on every successful `addLabel`. */
  applyLabelAdded(node: Node, label: string): void {
    const slice = asNodeSlice(node);
    this.label.addLabel(slice.id, label);
    this.property.onLabelAdded(slice, label);
    this.composite.onLabelAdded(slice, label);
  }

  /** Called on every successful `removeLabel`. */
  applyLabelRemoved(node: Node, label: string): void {
    const slice = asNodeSlice(node);
    this.label.removeLabel(slice.id, label);
    this.property.onLabelRemoved(slice, label);
    this.composite.onLabelRemoved(slice, label);
  }

  /** Called on every successful relationship create. */
  applyRelationshipCreated(rel: Relationship): void {
    this.adjacency.addEdge(asRelSlice(rel));
  }

  /** Called on every successful relationship delete. */
  applyRelationshipDeleted(rel: Relationship): void {
    this.adjacency.removeEdge(asRelSlice(rel));
  }

  /**
   * Rebuild all four indexes from the persisted node + relationship
   * streams provided by the engine.
   *
   * The streams must yield every node and every relationship exactly
   * once. The engine owns the I/O; we just consume.
   */
  async rebuildFromStreams(
    nodes: AsyncIterable<Node>,
    rels: AsyncIterable<Relationship>,
  ): Promise<void> {
    this.label.clear();
    this.property.clear();
    this.adjacency.clear();
    this.composite.clear();

    for await (const n of nodes) {
      this.applyNodeCreated(n);
    }
    for await (const r of rels) {
      this.applyRelationshipCreated(r);
    }
  }

  /** Cheap aggregate for diagnostics. */
  stats(): IndexStats {
    return {
      labelCount: this.label.size(),
      nodeCount: this.label.nodeCount(),
      propertyIndexCount: this.property.size(),
      adjacencyNodeCount: this.adjacency.size(),
      compositeIndexCount: this.composite.size(),
    };
  }
}

export { LabelIndex } from './label-index.js';
export { PropertyIndex } from './property-index.js';
export { AdjacencyIndex } from './adjacency-index.js';
export { CompositeIndex } from './composite-index.js';
export type { NodeSlice } from './types.js';
export {
  INDEXED_PROPERTIES,
  COMPOSITE_INDEXES,
  PROPERTIES_BY_LABEL,
  INDEXED_PROPERTY_KEYS,
} from './config.js';
