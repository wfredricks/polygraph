/**
 * Label index — `Map<Label, Set<NodeId>>`.
 *
 * Why: Every `findNodes(label)` call today does an adapter scan that
 * sorts the entire key-space and yields one key per labelled node, then
 * fetches each node by id. With ~250K adapter keys at 50K nodes that's
 * `O(K log K)` per call. An in-memory `Map<Label, Set<NodeId>>` makes
 * the scan an `O(matches)` iteration over a `Set` plus N `getNode()`s.
 * The remaining cost shifts to node materialization, which is honest
 * work — sorting all keys to find Twins is not.
 *
 * The set of ids per label is the *primary* shape callers need. We do
 * not also store the full Node here because (a) it doubles memory and
 * (b) it forces the index to mirror property writes for every label,
 * even labels with no indexed properties.
 *
 * @tier polygraph
 * @capability indexes.label
 */

import type { NodeId } from '../types.js';
import type { NodeSlice, ReadableIndex } from './types.js';

export class LabelIndex implements ReadableIndex {
  private byLabel: Map<string, Set<NodeId>> = new Map();
  /** All node ids known to the index, for `allNodes()` style queries. */
  private allIds: Set<NodeId> = new Set();

  /** Total distinct labels currently tracked. */
  size(): number {
    return this.byLabel.size;
  }

  /** Total nodes tracked across all labels. Used by tests + diagnostics. */
  nodeCount(): number {
    return this.allIds.size;
  }

  /** Insert a node into the index. Idempotent. */
  add(node: NodeSlice): void {
    this.allIds.add(node.id);
    for (const label of node.labels) {
      let bucket = this.byLabel.get(label);
      if (!bucket) {
        bucket = new Set();
        this.byLabel.set(label, bucket);
      }
      bucket.add(node.id);
    }
  }

  /**
   * Remove a node from the index entirely (all labels).
   *
   * `labels` is the snapshot of labels the node *had* at the time of
   * deletion — callers must pass it because we do not retain the
   * node's properties.
   */
  remove(nodeId: NodeId, labels: readonly string[]): void {
    this.allIds.delete(nodeId);
    for (const label of labels) {
      const bucket = this.byLabel.get(label);
      if (!bucket) continue;
      bucket.delete(nodeId);
      if (bucket.size === 0) this.byLabel.delete(label);
    }
  }

  /** Add a single label to a node (called by `PolyGraph.addLabel`). */
  addLabel(nodeId: NodeId, label: string): void {
    this.allIds.add(nodeId);
    let bucket = this.byLabel.get(label);
    if (!bucket) {
      bucket = new Set();
      this.byLabel.set(label, bucket);
    }
    bucket.add(nodeId);
  }

  /** Remove a single label from a node (called by `PolyGraph.removeLabel`). */
  removeLabel(nodeId: NodeId, label: string): void {
    const bucket = this.byLabel.get(label);
    if (!bucket) return;
    bucket.delete(nodeId);
    if (bucket.size === 0) this.byLabel.delete(label);
  }

  /**
   * All node ids carrying the given label.
   *
   * Returns a (frozen-ish) reference to the underlying Set. Callers
   * must not mutate it; if iteration could outlive a delete, snapshot
   * with `Array.from(...)`. PolyGraph operations always copy before
   * iterating to avoid this footgun.
   */
  lookup(label: string): ReadonlySet<NodeId> {
    return this.byLabel.get(label) ?? EMPTY;
  }

  /** All node ids in the graph (deduped across labels). */
  allNodeIds(): ReadonlySet<NodeId> {
    return this.allIds;
  }

  /** All distinct labels currently tracked. */
  labels(): IterableIterator<string> {
    return this.byLabel.keys();
  }

  /** Clear the index. Used by rebuild. */
  clear(): void {
    this.byLabel.clear();
    this.allIds.clear();
  }
}

const EMPTY: ReadonlySet<NodeId> = new Set();
