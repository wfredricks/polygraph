/**
 * Pure serialization functions.
 *
 * Why: Centralizes all pack/unpack logic so the engine never touches msgpackr directly.
 * If we ever swap serialization formats (e.g., CBOR, protobuf), we change one file.
 *
 * Architecture: 90% pure functions / 10% I/O shell. This is the 90%.
 */

import { pack, unpack } from 'msgpackr';
import type { Node, Relationship } from '../types.js';

/** Marker value for index entries and adjacency markers */
const EXISTS_MARKER = Buffer.from([1]);

/** Serialize a node to a Buffer */
export function serializeNode(node: Node): Buffer {
  return Buffer.from(pack(node));
}

/** Deserialize a Buffer to a Node */
export function deserializeNode(buffer: Buffer): Node {
  return unpack(buffer) as Node;
}

/** Serialize a relationship to a Buffer */
export function serializeRelationship(rel: Relationship): Buffer {
  return Buffer.from(pack(rel));
}

/** Deserialize a Buffer to a Relationship */
export function deserializeRelationship(buffer: Buffer): Relationship {
  return unpack(buffer) as Relationship;
}

/** Serialize a counter value */
export function serializeCounter(value: number): Buffer {
  return Buffer.from(pack(value));
}

/** Deserialize a counter value */
export function deserializeCounter(buffer: Buffer): number {
  return unpack(buffer) as number;
}

/** Get the exists marker Buffer (reused for all index/adjacency entries) */
export function existsMarker(): Buffer {
  return EXISTS_MARKER;
}
