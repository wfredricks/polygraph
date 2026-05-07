/**
 * NIST 800-53 Rev 5 — SI (System and Information Integrity) Security Tests
 *
 * Controls tested:
 *   SI-10  Information Input Validation
 *   SI-16  Memory Protection
 *   SI-7   Software and Information Integrity
 *
 * Why: PolyGraph must handle adversarial inputs safely. No input should cause
 * code execution, memory corruption, information leakage, or denial of service.
 * This includes prototype pollution, injection via keys/values, oversized payloads,
 * and deeply nested structures.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../../engine.js';

describe('NIST 800-53: SI — System and Information Integrity', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('SI-10: Information Input Validation', () => {
    it('should handle empty labels array', async () => {
      const node = await graph.createNode([], { name: 'orphan' });
      expect(node).toBeDefined();
      expect(node.labels).toHaveLength(0);

      const retrieved = await graph.getNode(node.id);
      expect(retrieved).not.toBeNull();
    });

    it('should handle empty properties object', async () => {
      const node = await graph.createNode(['Empty'], {});
      expect(node).toBeDefined();
      expect(Object.keys(node.properties)).toHaveLength(0);
    });

    it('should handle Unicode in labels and properties', async () => {
      const node = await graph.createNode(
        ['人物', 'Персона', '🎭'],
        {
          name: '田中太郎',
          emoji: '🖇️',
          arabic: 'مرحبا',
          mixed: 'Hello 世界 🌍',
        }
      );

      const retrieved = await graph.getNode(node.id);
      expect(retrieved!.labels).toContain('人物');
      expect(retrieved!.labels).toContain('🎭');
      expect(retrieved!.properties.name).toBe('田中太郎');
      expect(retrieved!.properties.emoji).toBe('🖇️');
      expect(retrieved!.properties.arabic).toBe('مرحبا');
    });

    it('should handle special characters in property keys', async () => {
      const node = await graph.createNode(['Test'], {
        'key with spaces': 'value1',
        'key:with:colons': 'value2',
        'key/with/slashes': 'value3',
        'key.with.dots': 'value4',
        '': 'empty key',
      });

      const retrieved = await graph.getNode(node.id);
      expect(retrieved!.properties['key with spaces']).toBe('value1');
      expect(retrieved!.properties['key:with:colons']).toBe('value2');
      expect(retrieved!.properties['key/with/slashes']).toBe('value3');
      expect(retrieved!.properties['key.with.dots']).toBe('value4');
      expect(retrieved!.properties['']).toBe('empty key');
    });

    it('should handle special characters in relationship types', async () => {
      const a = await graph.createNode(['A'], {});
      const b = await graph.createNode(['B'], {});

      const rel = await graph.createRelationship(a.id, b.id, 'HAS_SPECIAL:TYPE');
      const retrieved = await graph.getRelationship(rel.id);
      expect(retrieved!.type).toBe('HAS_SPECIAL:TYPE');
    });

    it('should handle null and undefined property values', async () => {
      const node = await graph.createNode(['Test'], {
        nullVal: null,
        undefinedVal: undefined,
        zero: 0,
        emptyString: '',
        falseVal: false,
      });

      const retrieved = await graph.getNode(node.id);
      expect(retrieved!.properties.nullVal).toBeNull();
      expect(retrieved!.properties.zero).toBe(0);
      expect(retrieved!.properties.emptyString).toBe('');
      expect(retrieved!.properties.falseVal).toBe(false);
    });

    it('should handle very long string values without truncation', async () => {
      const longString = 'x'.repeat(100_000);
      const node = await graph.createNode(['Test'], { data: longString });

      const retrieved = await graph.getNode(node.id);
      expect(retrieved!.properties.data).toBe(longString);
      expect(retrieved!.properties.data.length).toBe(100_000);
    });

    it('should handle deeply nested property objects', async () => {
      // Build a 50-level deep object
      let deep: any = { value: 'bottom' };
      for (let i = 0; i < 50; i++) {
        deep = { nested: deep };
      }

      const node = await graph.createNode(['Test'], { deep });
      const retrieved = await graph.getNode(node.id);

      // Verify the structure survived serialization
      let current: any = retrieved!.properties.deep;
      for (let i = 0; i < 50; i++) {
        expect(current).toHaveProperty('nested');
        current = current.nested;
      }
      expect(current.value).toBe('bottom');
    });

    it('should handle array property values', async () => {
      const node = await graph.createNode(['Test'], {
        tags: ['red', 'green', 'blue'],
        numbers: [1, 2, 3],
        mixed: [1, 'two', true, null],
        empty: [],
      });

      const retrieved = await graph.getNode(node.id);
      expect(retrieved!.properties.tags).toEqual(['red', 'green', 'blue']);
      expect(retrieved!.properties.numbers).toEqual([1, 2, 3]);
      expect(retrieved!.properties.mixed).toEqual([1, 'two', true, null]);
      expect(retrieved!.properties.empty).toEqual([]);
    });

    it('should handle numeric edge cases in properties', async () => {
      const node = await graph.createNode(['Test'], {
        maxSafe: Number.MAX_SAFE_INTEGER,
        minSafe: Number.MIN_SAFE_INTEGER,
        float: 3.14159265358979,
        negative: -42,
        zero: 0,
        negativeZero: -0,
      });

      const retrieved = await graph.getNode(node.id);
      expect(retrieved!.properties.maxSafe).toBe(Number.MAX_SAFE_INTEGER);
      expect(retrieved!.properties.minSafe).toBe(Number.MIN_SAFE_INTEGER);
      expect(retrieved!.properties.float).toBe(3.14159265358979);
      expect(retrieved!.properties.negative).toBe(-42);
    });
  });

  describe('SI-16: Memory Protection', () => {
    it('should not allow prototype pollution via property names', async () => {
      const malicious = JSON.parse(
        '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}'
      );

      const node = await graph.createNode(['Test'], malicious);
      const retrieved = await graph.getNode(node.id);

      // The global Object prototype should not be polluted
      expect(({} as any).polluted).toBeUndefined();

      // The properties should be stored as regular keys, not interpreted
      expect(retrieved).not.toBeNull();
    });

    it('should not allow prototype pollution via label names', async () => {
      const node = await graph.createNode(
        ['__proto__', 'constructor', 'prototype'],
        { safe: true }
      );

      expect(({} as any).polluted).toBeUndefined();
      expect(node.labels).toContain('__proto__');
    });

    it('should not allow injection via property filter operators', async () => {
      await graph.createNode(['Test'], { name: 'Alice', role: 'admin' });
      await graph.createNode(['Test'], { name: 'Bob', role: 'user' });

      // Try to use filter operators that might be interpreted as code
      const results = await graph.findNodes('Test', {
        name: { $eq: 'Alice' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should handle concurrent operations without corruption', async () => {
      // Create 50 nodes concurrently
      const promises = Array.from({ length: 50 }, (_, i) =>
        graph.createNode(['Concurrent'], { index: i })
      );

      const nodes = await Promise.all(promises);

      // All should have unique IDs
      const ids = new Set(nodes.map((n) => n.id));
      expect(ids.size).toBe(50);

      // Stats should be accurate
      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(50);

      // All should be retrievable
      for (const node of nodes) {
        const retrieved = await graph.getNode(node.id);
        expect(retrieved).not.toBeNull();
      }
    });
  });

  describe('SI-7: Software and Information Integrity', () => {
    it('should maintain graph consistency after failed operations', async () => {
      const node = await graph.createNode(['Stable'], { data: 'original' });

      // Attempt an invalid operation
      try {
        await graph.createRelationship(node.id, 'non-existent', 'BAD');
      } catch {
        // Expected to fail
      }

      // Original node should be unaffected
      const retrieved = await graph.getNode(node.id);
      expect(retrieved!.properties.data).toBe('original');

      // Stats should be consistent
      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(1);
      expect(stats.relationshipCount).toBe(0);
    });

    it('should maintain referential integrity — no orphaned relationships', async () => {
      const a = await graph.createNode(['A'], {});
      const b = await graph.createNode(['B'], {});
      const c = await graph.createNode(['C'], {});

      await graph.createRelationship(a.id, b.id, 'LINKS');
      await graph.createRelationship(b.id, c.id, 'LINKS');

      // Delete middle node — its relationships should be cleaned up
      await graph.deleteNode(b.id);

      // No relationships should reference deleted node
      const allRels = await graph.findRelationships('LINKS');
      for (const rel of allRels) {
        expect(rel.startNode).not.toBe(b.id);
        expect(rel.endNode).not.toBe(b.id);
      }
    });

    it('should preserve data fidelity through update cycles', async () => {
      const node = await graph.createNode(['Test'], {
        version: 1,
        data: 'original',
      });

      // Multiple updates
      await graph.updateNode(node.id, { version: 2, data: 'updated-1' });
      await graph.updateNode(node.id, { version: 3, data: 'updated-2' });
      await graph.updateNode(node.id, { version: 4, data: 'final' });

      const retrieved = await graph.getNode(node.id);
      expect(retrieved!.properties.version).toBe(4);
      expect(retrieved!.properties.data).toBe('final');
    });
  });
});
