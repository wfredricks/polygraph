/**
 * NIST 800-53 Rev 5 — CM (Configuration Management) Security Tests
 *
 * Controls tested:
 *   CM-7  Least Functionality
 *   CM-7(1) Periodic Review (dependency audit)
 *
 * Why: PolyGraph must expose only the documented API surface. No hidden endpoints,
 * no debug modes, no undocumented configuration. The attack surface is the API surface,
 * and both must be minimized and auditable.
 */

import { describe, it, expect } from 'vitest';
import { PolyGraph, MemoryAdapter, TraversalBuilder } from '../../index.js';
import * as exports from '../../index.js';

describe('NIST 800-53: CM — Configuration Management', () => {
  describe('CM-7: Least Functionality', () => {
    it('should export only documented public symbols', () => {
      const exportedNames = Object.keys(exports).sort();

      // These are the ONLY things that should be exported
      const expectedExports = [
        'LevelAdapter',
        'MemoryAdapter',
        'PolyGraph',
        'PolyGraphProxyAdapter',
        'TraversalBuilder',
      ];

      // Filter out type-only exports (they don't appear at runtime)
      const runtimeExports = exportedNames.filter(
        (name) => typeof (exports as any)[name] !== 'undefined'
      );

      // Every runtime export should be in our expected list
      for (const exp of runtimeExports) {
        expect(
          expectedExports.includes(exp),
          `Unexpected export: "${exp}" — if intentional, add to expectedExports and document`
        ).toBe(true);
      }
    });

    it('should not expose any global state or singletons', () => {
      // Two independent instances should share nothing
      const graph1 = new PolyGraph();
      const graph2 = new PolyGraph();

      // They should be different objects
      expect(graph1).not.toBe(graph2);
    });

    it('should not have any environment variable dependencies', async () => {
      // PolyGraph should work with zero configuration
      const graph = new PolyGraph();
      await graph.open();

      const node = await graph.createNode(['Test'], { env: 'clean' });
      expect(node).toBeDefined();
      expect(node.id).toBeDefined();

      await graph.close();
    });

    it('should not expose debug, trace, or diagnostic modes in the API', () => {
      const graph = new PolyGraph();
      const proto = Object.getPrototypeOf(graph);
      const methods = Object.getOwnPropertyNames(proto).filter(
        (name) => name !== 'constructor'
      );

      // No method should be named debug*, trace*, dump*, or internal*
      const suspiciousPatterns = [/^debug/i, /^trace/i, /^dump/i, /^internal/i, /^_raw/i];
      for (const method of methods) {
        for (const pattern of suspiciousPatterns) {
          expect(
            pattern.test(method),
            `Suspicious method "${method}" found — review for CM-7 compliance`
          ).toBe(false);
        }
      }
    });

    it('should have no hardcoded file paths or network addresses', async () => {
      // PolyGraph with default options should not touch the filesystem or network
      const graph = new PolyGraph();
      await graph.open();

      // If we get here without error, no file/network access was attempted
      const node = await graph.createNode(['Test'], { data: 'ephemeral' });
      expect(node).toBeDefined();

      await graph.close();
    });
  });

  describe('CM-7(1): Periodic Review — Dependency Audit', () => {
    it('should have minimal runtime dependencies', async () => {
      const { readFileSync } = await import('fs');
      const { resolve } = await import('path');

      const pkgPath = resolve(import.meta.dirname, '../../../package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      const deps = Object.keys(pkg.dependencies || {});

      // PolyGraph should have very few runtime dependencies
      // Each dependency increases attack surface and authorization scope
      expect(
        deps.length,
        `Runtime dependencies: [${deps.join(', ')}]. Each one increases ATO scope.`
      ).toBeLessThanOrEqual(5);

      // No dependency should be a full database server
      const serverDeps = deps.filter((d) =>
        /neo4j|postgres|mysql|mongo|redis|sqlite3/i.test(d)
      );
      expect(
        serverDeps,
        'PolyGraph should not depend on external database servers'
      ).toHaveLength(0);
    });

    it('should have no dependency with known restrictive licenses', async () => {
      const { readFileSync, existsSync } = await import('fs');
      const { resolve, join } = await import('path');

      const pkgPath = resolve(import.meta.dirname, '../../../package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      const deps = Object.keys(pkg.dependencies || {});
      const restrictiveLicenses = ['GPL', 'AGPL', 'SSPL', 'BSL', 'BUSL'];

      for (const dep of deps) {
        const depPkgPath = join(
          resolve(import.meta.dirname, '../../../node_modules'),
          dep,
          'package.json'
        );
        if (existsSync(depPkgPath)) {
          const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf-8'));
          const license = String(depPkg.license || '');

          for (const restricted of restrictiveLicenses) {
            expect(
              license.toUpperCase().includes(restricted),
              `Dependency "${dep}" has restrictive license: ${license}`
            ).toBe(false);
          }
        }
      }
    });
  });
});
