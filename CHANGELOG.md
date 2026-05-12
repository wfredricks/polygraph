# Changelog

All notable changes to PolyGraph are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-05-12

Packaging fix to make `npm install github:owner/polygraph#vX.Y.Z`
actually produce a usable package. v0.1.1 shipped without a `prepare`
script and without `src/` in `package.json.files`, so a git-URL install
left `node_modules/polygraph-db/` with only README + LICENSE + the
package.json itself — no `src/` to build from and no `dist/` to load.

### Fixed

- `package.json` now declares `"prepare": "npm run build"` so the
  tarball produced by `npm install <git-url>` runs the tsup build
  before being consumed.
- `src` is added to the `files` whitelist so the published artifact
  (and the git-install tarball) carries it. tsup needs it to produce
  `dist/`, and `tsconfig.json` references it.

### Verified

- `npm pack` from the source repo produces a 76-file tarball (was 9).
- Installing the tarball into a fresh project gives a working
  `polygraph-db` with `dist/index.cjs`, `dist/index.d.ts`, and a
  loadable `PolyGraph` class.

## [0.1.1] — 2026-05-12

This release lands several months of development that had been
happening in a vendored consumer copy. From this point on, all
PolyGraph work happens in this repository, versions are bumped per
change, and consumers install via tarball or registry rather than
editing source in place. See `PUBLISHING.md` (forthcoming in the
workspace root) for the discipline.

### Fixed

- **`allNodes()` silently dropped nodes whose ids contain colons.**
  `streamPersistedNodes` walked the label-index keyspace
  (`i:l:{label}:{nodeId}`) and extracted the node id with a
  split-on-`:`; ids like `foundation/auth:createAuthProvider` were
  truncated to `createAuthProvider` and silently skipped during the
  in-memory index rebuild on `open()`. The historical comment "nodeIds
  don't contain colons" was wrong — structured ids routinely use them.
  Surfaced by a parity test against a real 2,113-node codebase SIG:
  pre-fix `allNodes()` returned 955 of 2,113 nodes; post-fix it
  returns the full count and matches `stats()`. New
  `labelIndexNodeId(key)` parser in `pure/keys.ts` is colon-safe; the
  unsafe `lastSegment` helper now has a `⚠️` warning pinning its
  contract.

### Added

- **`src/indexes/`** — IndexManager that holds the in-memory label,
  property, adjacency, and composite indexes. Reflects every write
  synchronously after the storage adapter confirms it; rebuilt from
  persistent state on every `open()`.
- **`src/qengine/`** — v0 query engine slice. Parses
  `MATCH (n:Label) RETURN n` (with alias support), lowers to a
  logical plan, then a physical plan (LabelScan + Project), then
  executes against a `PolyGraph`. Fail-loud on every refused shape
  (multi-MATCH, multi-pattern, multi-label, unbound RETURN). Intended
  as the parallel successor to the regex Cypher bridge.
- **`src/__benchmarks__/baseline.ts`** — benchmark fixtures.
- **Scenarios test suite (`src/__tests__/scenarios/`)** — shape-driven
  tests for the failure modes that line-coverage alone can't catch:
  - `colon-ids.test.ts` — punctuated ids (slashes, multiple colons,
    unicode, whitespace, ids colliding textually with labels) across
    every read path, before and after close+reopen.
  - `multi-label.test.ts` — nodes with multiple labels appear in
    every label's `findNodes` bucket; `allNodes` dedupes by id;
    `addLabel` / `removeLabel` keep state consistent; deletes vacate
    every label bucket.
  - `reopen-roundtrip.test.ts` — the rebuild-on-open invariant: a
    mixed graph survives close/reopen with `stats`, `findNodes`, and
    adjacency intact; deletes stick across reopens; two reopen
    cycles are deterministic.
- **`src/__tests__/keys.test.ts`** — covers every key formatter and
  parser. Includes a documentation-style test pinning `lastSegment`'s
  unsafe-for-label-index behaviour so a future refactor can't
  accidentally regress.
- **`src/__tests__/proxy-transactions.test.ts`** — fills the previously
  thin coverage of the proxy adapter's transaction shim, `reset()`,
  count getters, and `hasFeature`.
- **`src/qengine/__tests__/plan-guards.test.ts`** — every fail-loud
  branch in the v0 planner plus the row-adapter purity contract.

### Changed

- **`vitest.config.ts`** — coverage now gated at
  `statements ≥ 85` / `branches ≥ 75` / `functions ≥ 90` /
  `lines ≥ 85`. The aspirational ceiling is 95% statements / 100%
  functions, tracked in ROADMAP. Type-only barrel files and benchmark
  fixtures are excluded from coverage (they were counting as 0%
  covered without measuring anything real).
- **README.md** — new **Indexing** section documents the four index
  layers, the LevelDB key schema, the rebuild-on-open contract,
  multi-label semantics, which read shape to reach for, and the
  colon-safe `labelIndexNodeId` parser. Status section refreshed to
  reflect current test count (482) and coverage (91% / 94% / 98%).

### Coverage

- 482 tests across 34 files, 100% pass, ~10 s wall-clock.
- 91.09% statements / 93.94% lines / 98.09% functions.

## [0.1.0] — 2026-04 (initial drop)

- Core engine MVP: labeled property graph, CRUD, traversal, indexes,
  transactions.
- Storage adapters: in-memory (default) and LevelDB.
- Lightweight Cypher bridge (regex-based, see `pure/cypher.ts`).
- `PolyGraphProxyAdapter` — application-level provider-agnostic
  interface.
- 343 tests, ~95% statement coverage on the engine surface as it
  existed then.
