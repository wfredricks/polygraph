/**
 * Pure key generation functions for the storage layer.
 *
 * Why: The key schema is the heart of PolyGraph's index-free adjacency design.
 * These functions centralize all key format knowledge in one place, making it
 * impossible for the engine and adapter to disagree about key structure.
 *
 * Architecture: 90% pure functions / 10% I/O shell. This is the 90%.
 *
 * Key Schema:
 *   n:{nodeId}                        → Node data
 *   n:{nodeId}:l:{label}              → Label marker
 *   n:{nodeId}:o:{relType}:{relId}    → Outgoing adjacency
 *   n:{nodeId}:i:{relType}:{relId}    → Incoming adjacency
 *   r:{relId}                         → Relationship data
 *   i:l:{label}:{nodeId}              → Label index
 *   i:p:{label}:{prop}:{value}:{nodeId} → Property index
 *   m:{counter}                       → Metadata counter
 */

import type { NodeId, RelId } from '../types.js';

// ─── Node Keys ─────────────────────────────────────────────────────

/** Primary node storage key */
export function nodeKey(id: NodeId): string {
  return `n:${id}`;
}

/** Label marker on a node */
export function nodeLabelKey(id: NodeId, label: string): string {
  return `n:${id}:l:${label}`;
}

/** Outgoing adjacency marker: node → relationship */
export function nodeOutKey(id: NodeId, relType: string, relId: RelId): string {
  return `n:${id}:o:${relType}:${relId}`;
}

/** Incoming adjacency marker: relationship → node */
export function nodeInKey(id: NodeId, relType: string, relId: RelId): string {
  return `n:${id}:i:${relType}:${relId}`;
}

/** Prefix for scanning all outgoing adjacencies of a node */
export function nodeOutPrefix(id: NodeId): string {
  return `n:${id}:o:`;
}

/** Prefix for scanning outgoing adjacencies of a specific type */
export function nodeOutTypePrefix(id: NodeId, relType: string): string {
  return `n:${id}:o:${relType}:`;
}

/** Prefix for scanning all incoming adjacencies of a node */
export function nodeInPrefix(id: NodeId): string {
  return `n:${id}:i:`;
}

/** Prefix for scanning incoming adjacencies of a specific type */
export function nodeInTypePrefix(id: NodeId, relType: string): string {
  return `n:${id}:i:${relType}:`;
}

// ─── Relationship Keys ─────────────────────────────────────────────

/** Primary relationship storage key */
export function relKey(id: RelId): string {
  return `r:${id}`;
}

/** Prefix for scanning all relationships */
export function relPrefix(): string {
  return 'r:';
}

// ─── Index Keys ────────────────────────────────────────────────────

/** Label index: find all nodes with a given label */
export function labelIndexKey(label: string, nodeId: NodeId): string {
  return `i:l:${label}:${nodeId}`;
}

/** Prefix for scanning all nodes with a given label */
export function labelIndexPrefix(label: string): string {
  return `i:l:${label}:`;
}

/** Property index: find nodes by label + property value */
export function propIndexKey(label: string, propKey: string, value: any, nodeId: NodeId): string {
  return `i:p:${label}:${propKey}:${String(value)}:${nodeId}`;
}

/** Prefix for scanning a property index for a specific value */
export function propIndexValuePrefix(label: string, propKey: string, value: any): string {
  return `i:p:${label}:${propKey}:${String(value)}:`;
}

/** Prefix for scanning all entries of a property index */
export function propIndexPrefix(label: string, propKey: string): string {
  return `i:p:${label}:${propKey}:`;
}

// ─── Metadata Keys ─────────────────────────────────────────────────

export const COUNTER_NODE_COUNT = 'm:nodeCount';
export const COUNTER_REL_COUNT = 'm:relCount';

// ─── Key Parsing ───────────────────────────────────────────────────

/**
 * Extracts the last segment from a colon-delimited key.
 *
 * Why: Adjacency keys are n:{nodeId}:o:{type}:{relId} — the relId is always last.
 * Using the last segment is safer than a fixed index because it doesn't break
 * if the nodeId or type format changes.
 */
export function lastSegment(key: string): string {
  const parts = key.split(':');
  return parts[parts.length - 1];
}

/**
 * Extracts the node ID from a label index key by stripping the prefix.
 *
 * Why: Label index keys are i:l:{label}:{nodeId}. Stripping the known prefix
 * is safer than splitting because nodeIds don't contain colons.
 */
export function stripPrefix(key: string, prefix: string): string {
  return key.slice(prefix.length);
}
