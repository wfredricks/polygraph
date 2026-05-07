/**
 * Pure filter evaluation functions.
 *
 * Why: Property filtering is pure logic — takes properties and a filter, returns boolean.
 * No I/O, no state, no side effects. Easily testable in isolation.
 *
 * Architecture: 90% pure functions / 10% I/O shell. This is the 90%.
 */

import type { PropertyFilter } from '../types.js';

/**
 * Evaluates whether a set of properties matches a filter.
 *
 * Why: Used by findNodes, findRelationships, traversal, and neighborhood
 * to apply user-specified conditions. Supports 11 operators.
 *
 * @param properties - The properties to test
 * @param filter - The filter conditions
 * @returns true if all conditions are satisfied
 */
export function matchesFilter(properties: Record<string, any>, filter: PropertyFilter): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const value = properties[key];

    // Handle direct value (implicit $eq)
    if (typeof condition !== 'object' || condition === null) {
      if (value !== condition) return false;
      continue;
    }

    // Handle comparison operators
    if ('$eq' in condition && value !== condition.$eq) return false;
    if ('$neq' in condition && value === condition.$neq) return false;
    if ('$gt' in condition && !(value > condition.$gt)) return false;
    if ('$gte' in condition && !(value >= condition.$gte)) return false;
    if ('$lt' in condition && !(value < condition.$lt)) return false;
    if ('$lte' in condition && !(value <= condition.$lte)) return false;
    if ('$in' in condition && !condition.$in.includes(value)) return false;
    if ('$contains' in condition && !String(value).includes(condition.$contains)) return false;
    if ('$startsWith' in condition && !String(value).startsWith(condition.$startsWith)) return false;
    if ('$endsWith' in condition && !String(value).endsWith(condition.$endsWith)) return false;
    if ('$exists' in condition) {
      const exists = value !== undefined && value !== null;
      if (exists !== condition.$exists) return false;
    }
  }

  return true;
}

/**
 * Extracts an equality value from a filter condition (for index optimization).
 *
 * Why: When a condition is a simple equality ($eq or direct value), we can use
 * the property index for O(1) lookup instead of scanning all nodes.
 *
 * @param condition - A single filter condition
 * @returns The equality value, or undefined if not an equality condition
 */
export function extractEqualityValue(condition: any): any {
  if (typeof condition !== 'object' || condition === null) {
    return condition; // Direct value = implicit $eq
  }
  if ('$eq' in condition) {
    return condition.$eq;
  }
  return undefined;
}
