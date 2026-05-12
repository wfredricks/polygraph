# PolyGraph

**An embeddable graph database you can own, audit, and authorize.**

Graph databases store data as networks of connected entities - nodes, relationships, and properties - making them ideal for supply chains, audit trails, knowledge graphs, digital twins, and any domain where *how things connect* matters as much as the things themselves.

PolyGraph gives you that power as a library. No separate server. No vendor licensing. No authorization gaps. Import it like SQLite, build your graph, traverse it - all in TypeScript.

## Who is this for?

- **Government & defense teams** who need a graph database they can FedRAMP authorize, STIG harden, or deploy to IL4/5 - without waiting for a vendor who may never get there
- **Regulated industries** where every dependency in your stack must be auditable and explainable
- **AI & digital twin builders** who want graph-native intelligence without the ops burden of a database server
- **Anyone** tired of authorizing 100% of a product to use 20% of its features

## Why PolyGraph?

Commercial graph databases are powerful but come with trade-offs:

- **Licensing constraints** that limit how you deploy and distribute
- **Operational complexity** of running a separate database server
- **Authorization gaps** — Neo4j has no FedRAMP ATO and shows no trajectory toward one
- **Feature bloat** when you need labeled property graphs but must authorize enterprise clustering, LDAP, and 50 APOC procedures you’ll never touch

PolyGraph is the alternative: a small, readable codebase that does what you need and nothing you have to explain to an assessor. Every line is auditable, modifiable, and ownable.

|  | PolyGraph | Neo4j Community | AWS Neptune |
|---|---|---|---|
| **Install** | `npm install` (2 sec) | Docker + config (30 min) | CloudFormation (hours) |
| **Runtime** | In-process | Separate JVM server | Managed service |
| **Memory (10K nodes)** | 12.5 MB | ~200 MB (JVM) | N/A |
| **Package size** | 31 KB | 600 MB | N/A |
| **License** | Apache 2.0 | GPL + commercial | Proprietary |
| **FedRAMP** | You authorize it | Not authorized | Yes (AWS) |
| **NIST 800-53 tests** | 60 (shipped) | You write them | AWS shared model |
| **Air-gap capable** | Yes | Yes | No |

See **[WHY-POLYGRAPH.md](WHY-POLYGRAPH.md)** for the full comparison and rationale.

## Quick Start

```bash
npm install polygraph-db
```

```typescript
import { PolyGraph } from 'polygraph-db';

const graph = new PolyGraph();
await graph.open();

// Create nodes
const alice = await graph.createNode(['Person'], { name: 'Alice', role: 'Engineer' });
const bob = await graph.createNode(['Person'], { name: 'Bob', role: 'Manager' });
const project = await graph.createNode(['Project'], { name: 'PolyGraph', status: 'active' });

// Create relationships
await graph.createRelationship(alice.id, project.id, 'WORKS_ON', { since: '2026-05' });
await graph.createRelationship(bob.id, project.id, 'MANAGES');
await graph.createRelationship(alice.id, bob.id, 'REPORTS_TO');

// Traverse
const team = await graph.traverse(project.id).incoming('WORKS_ON').collect();
// → [alice]

const chain = await graph.traverse(alice.id).outgoing('REPORTS_TO').depth(3).collect();
// → [bob]

// Shortest path
const path = await graph.shortestPath(alice.id, project.id);
// → alice → WORKS_ON → project

// Neighborhood
const neighborhood = await graph.neighborhood(bob.id, 2);
// → all nodes and relationships within 2 hops of Bob

// Stats
const stats = await graph.stats();
// → { nodeCount: 3, relationshipCount: 3, indexCount: 0 }

await graph.close();
```

## Features

**Graph Model**
- Labeled property graph (nodes with labels + properties, typed relationships with properties)
- Full CRUD for nodes and relationships
- Label management (add, remove, query)
- Cascade delete (removing a node removes all connected relationships)

**Querying**
- Property filter operators: `$eq`, `$neq`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$contains`, `$startsWith`, `$endsWith`, `$exists`
- Property indexes with automatic backfill
- Label-based node lookups via the always-on label index
- Multi-label nodes (a node can carry any number of labels and appears in every label's index)

See [Indexing](#indexing) for the full index story — what's persisted, what's rebuilt on `open()`, and which read shape to reach for.

**Traversal**
- Fluent builder API: `.outgoing()`, `.incoming()`, `.both()`, `.where()`, `.depth()`, `.limit()`, `.unique()`
- Multi-step chains: `.outgoing('KNOWS').incoming('WORKS_AT')` - follow patterns across relationship types
- Three collection modes: `collect()` (nodes), `collectPaths()` (full paths), `collectSubgraph()` (nodes + relationships)

**Cypher Bridge**
- Lightweight Cypher query support for Neo4j familiarity
- Supported: MATCH, WHERE, RETURN, CREATE, SET, DELETE, LIMIT
- WHERE operators: `=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`

```typescript
// Query with Cypher — feels like Neo4j
const friends = await graph.query(
  `MATCH (a:Person)-[:KNOWS]->(b:Person) WHERE a.name = 'Alice' RETURN b.name`
);

// Create with Cypher
await graph.query(`CREATE (n:Person {name: 'Bob', age: 25})`);

// Update with Cypher
await graph.query(`MATCH (n:Person) WHERE n.name = 'Bob' SET n.age = 26`);

// Delete with Cypher
await graph.query(`MATCH (n:Temp) WHERE n.status = 'expired' DELETE n`);
```

**Algorithms**
- BFS shortest path
- Dijkstra weighted shortest path (via `costProperty`)
- Neighborhood extraction with depth, direction, and type filters

**Transactions**
- `withTx()` for grouped operations
- Serialized counters (safe under concurrent writes)

**Storage**
- Pluggable adapter pattern
- In-memory adapter (default) - zero native dependencies, instant startup
- **LevelDB adapter** - persistent, production-grade, data survives restarts

```typescript
import { PolyGraph, LevelAdapter } from 'polygraph-db';

const graph = new PolyGraph({
  adapter: new LevelAdapter({ path: './my-graph-db' })
});
await graph.open();
// ... your graph persists to disk
await graph.close();
```

## Indexing

PolyGraph's indexes are **always-on derived state**, not opt-in structures you decide to maintain. Every write goes through the engine; the engine reflects it into the appropriate index synchronously after the storage adapter confirms the write. On `open()` the engine streams every persisted node and relationship back through the index manager, so the in-memory state is always a faithful function of what's on disk.

**Four index layers, all in-memory, all rebuilt from persistent storage on `open()`:**

| Layer | What it answers | Cost |
|---|---|---|
| **Label index** | "All nodes carrying label X" + "every node id in the store" | O(matches) lookup, O(nodes × labels-per-node) rebuild |
| **Property index** | "All X-labelled nodes where prop = value" (opt-in via `createIndex(label, prop)`) | O(matches) lookup, O(nodes) backfill on `createIndex` |
| **Adjacency index** | "Outgoing/incoming neighbors of node X by relationship type" | O(neighbors) walk, no index hop |
| **Composite index** | Pre-configured `(label, prop1, prop2)` triples for hot multi-key reads | O(matches) lookup |

**Storage layout (LevelDB keys).** Every operation maps to a deterministic key schema:

```
n:{nodeId}                          → Node body
n:{nodeId}:l:{label}                → Label marker on a node
n:{nodeId}:o:{relType}:{relId}      → Outgoing adjacency (no index hop)
n:{nodeId}:i:{relType}:{relId}      → Incoming adjacency
r:{relId}                           → Relationship body
i:l:{label}:{nodeId}                → Label index entry
i:p:{label}:{prop}:{value}:{nodeId} → Property index entry
```

Node ids and labels are caller-supplied strings and may contain colons (e.g. `foundation/auth:createAuthProvider`, `some/path:Type`). The colon-safe parser (`labelIndexNodeId`) is the one to use when extracting an id from a label-index key during a scan; the older `lastSegment` helper is fine for adjacency keys (which always end in a colon-free relationship UUID) but unsafe for label-index keys with colon-bearing ids.

**Which read shape to reach for:**

- **`findNodes(label, filter?)`** — the dominant read. Hits the in-memory label index, then optionally walks a property index if `filter` matches a configured `(label, prop)` pair. O(matches).
- **`getNode(id)`** — single key lookup. Use when you already have an id (e.g. a traversal endpoint).
- **`getNeighbors(id, types?, direction?)`** — the adjacency index. O(neighbors) regardless of graph size. The right shape for any "who connects to X" question.
- **`traverse(id)`** — fluent builder over `getNeighbors`. Use for multi-hop patterns.
- **`allNodes()`** — every node, deduped. Backed by the label index's union-of-all-ids set. Use sparingly; if you can name a label, prefer `findNodes`.
- **`stats()`** — counters only. Use for size checks, not membership.

**Multi-label nodes.** A node with `labels: ['Requirement', 'PlannedRequirement']` appears in both label-index buckets and is returned by `findNodes` for either label. `allNodes()` deduplicates by id so the same node is yielded once regardless of label cardinality. `addLabel` and `removeLabel` mutate both persistent and in-memory state atomically.

**Rebuild on open.** When a `LevelAdapter`-backed graph is reopened, the engine walks `i:l:*` (label-index keys) and `r:*` (relationship bodies) to rebuild every in-memory index from persistent state. The walk is bounded by graph size and dominates startup time above ~10K nodes; everything after is in-memory speed.

**Index correctness was the focus of the 2026-05-12 audit.** A parity test against a real 2,113-node / 3,177-relationship codebase SIG (loaded 1:1 from a Neo4j export) caught a silent dedup bug in `allNodes()` for node ids containing colons. The scenarios suite (`src/__tests__/scenarios/`) now pins colon-id, multi-label, and write→close→reopen invariants against the same real-world shapes.

## Design Principles

1. **Embed, don't deploy.** Import like SQLite. No server process, no wire protocol, no ops.
2. **Purpose-built, not general-purpose.** We build what real workloads need. No speculative features.
3. **Proven foundations.** Storage is delegated to battle-tested engines (LevelDB). We build graph semantics on top.
4. **TypeScript-native.** Fluent API, full type safety, no query language needed. Your IDE is your query tool.
5. **Auditable.** Every line readable. Small codebase = smaller attack surface = faster authorization.

## Performance

Benchmarked on Apple M-series (Mac mini, in-memory adapter):

**CRUD Throughput**

| Operation | ops/sec | Avg Latency |
|-----------|---------|-------------|
| Node CREATE | 181,000 | 6μs |
| Node READ | 864,000 | 1μs |
| Node UPDATE | 365,000 | 3μs |
| Relationship CREATE | 142,000 | 7μs |
| Relationship READ | 843,000 | 1μs |

**Traversal Throughput** (1,000-node graphs)

| Operation | ops/sec | Avg Latency |
|-----------|---------|-------------|
| Depth-1 (5 neighbors) | 1,783 | 561μs |
| Depth-2 (30 nodes, tree) | 288 | 3.5ms |
| Depth-4 (780 nodes, full tree) | 12 | 83ms |
| Friends-of-friends (social) | 55 | 18ms |
| Neighborhood depth-2 | 159 | 6.3ms |
| Shortest path (~50 hops) | 27 | 36ms |

**Memory Footprint**

| Scale | Total | Per Entity |
|-------|-------|------------|
| 1K nodes | 2.1 MB | ~2.1 KB/node |
| 10K nodes | 12.5 MB | ~1.3 KB/node |
| 10K nodes + 20K rels | 38.5 MB | ~1.3 KB/entity |
| Empty graph | 2.5 KB | - |

Full benchmark suite: `npm run test:bench`

## Status & Roadmap

**v0.1 — Core Engine MVP** ✅ *(current)*

- **479 tests** across 34 files (engine, adapters, indexes, proxy, cypher bridge, qengine, scenarios, security, benchmarks)
- **91% statements / 94% lines / 97% functions** coverage (gate set at 85/85; aspirational target 95% statements)
- LevelDB persistence with full reopen fidelity, including multi-label and colon-bearing node ids
- Parity-tested against a real 2,113-node / 3,177-relationship Neo4j codebase SIG (5/5 functional queries pass; PolyGraph is 3–7× faster on focused queries thanks to in-process execution)
- 100-transaction audit workload completes in ~25 ms

**v0.2 — Persistent Storage** 🔨
- ~~LevelDB adapter~~ ✅ · ~~Reopen-fidelity test suite~~ ✅ · WAL crash recovery · backup/restore · npm publish

**v0.3 — Hardening & Server Mode**
- REST/gRPC wrapper, health/metrics, auth, connection pooling

**v0.4 — Query Language (qengine)**
- A v0 slice of `MATCH (n:Label) RETURN n` is wired and exercised by tests (see `src/qengine/`). Next slices add WHERE pushdown, parameters, multi-pattern matches.

See **[ROADMAP.md](ROADMAP.md)** for the full plan, design rationale, and future directions.

## Architecture

```
┌─────────────────────────────────────────────┐
│              Your Application                │
├─────────────────────────────────────────────┤
│               PolyGraph Engine               │
│  Graph API · Traversal · Indexes · Tx Mgr   │
│  Cypher Bridge · Graph Proxy · qengine (v0)  │
├─────────────────────────────────────────────┤
│            Storage Adapter                   │
│   MemoryAdapter (default) │ LevelAdapter      │
└─────────────────────────────────────────────┘
```

**Graph Proxy** — Application-level adapter pattern. Drop-in replacement for Neo4j adapters:

```typescript
import { PolyGraphProxyAdapter } from 'polygraph-db';

const adapter = new PolyGraphProxyAdapter({ storage: 'persistent', path: './data' });
await adapter.connect();
await adapter.createGraphSpace('my-app');

// Full CRUD, traversal, upsert, batch, portable queries, Cypher — all through one interface
const node = await adapter.createNode('my-app', 'Person', { name: 'Alice' });
```

**Key design:** Index-free adjacency. Outgoing and incoming relationships are stored directly with the node via sorted key prefixes, making neighbor traversal O(neighbors) with no index hop. This is the same principle that makes Neo4j fast — we just implement it on our terms.

See [Indexing](#indexing) above for the full index design — what's persistent, what's derived, and the rebuild contract on `open()`.

## License

Apache 2.0 - use it, modify it, own it.

## Contributing

This is a young project. Issues, ideas, and PRs are welcome. If you're working in a government or regulated environment and need a graph database you can authorize, we'd especially love to hear from you.
