# PolyGraph

**An embeddable graph database you can own, audit, and authorize.**

Graph databases store data as networks of connected entities — nodes, relationships, and properties — making them ideal for supply chains, audit trails, knowledge graphs, digital twins, and any domain where *how things connect* matters as much as the things themselves.

PolyGraph gives you that power as a library. No separate server. No vendor licensing. No authorization gaps. Import it like SQLite, build your graph, traverse it — all in TypeScript.

## Who is this for?

- **Government & defense teams** who need a graph database they can FedRAMP authorize, STIG harden, or deploy to IL4/5 — without waiting for a vendor who may never get there
- **Regulated industries** where every dependency in your stack must be auditable and explainable
- **AI & digital twin builders** who want graph-native intelligence without the ops burden of a database server
- **Anyone** tired of authorizing 100% of a product to use 20% of its features

## Why PolyGraph?

Commercial graph databases are powerful but come with trade-offs:

- **Licensing constraints** that limit how you deploy and distribute
- **Operational complexity** of running a separate database server
- **Authorization gaps** — Neo4j has no FedRAMP ATO and shows no trajectory toward one
- **Feature bloat** when you need labeled property graphs but must authorize enterprise clustering, LDAP, and 50 APOC procedures you'll never touch

PolyGraph is the alternative: a small, readable codebase that does what you need and nothing you have to explain to an assessor. Every line is auditable, modifiable, and ownable.

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
- Label-based node lookups

**Traversal**
- Fluent builder API: `.outgoing()`, `.incoming()`, `.both()`, `.where()`, `.depth()`, `.limit()`, `.unique()`
- Multi-step chains: `.outgoing('KNOWS').incoming('WORKS_AT')` — follow patterns across relationship types
- Three collection modes: `collect()` (nodes), `collectPaths()` (full paths), `collectSubgraph()` (nodes + relationships)

**Algorithms**
- BFS shortest path
- Dijkstra weighted shortest path (via `costProperty`)
- Neighborhood extraction with depth, direction, and type filters

**Transactions**
- `withTx()` for grouped operations
- Serialized counters (safe under concurrent writes)

**Storage**
- Pluggable adapter pattern
- In-memory adapter (default) — zero dependencies, instant startup
- RocksDB adapter (coming) — persistent, production-grade

## Design Principles

1. **Embed, don't deploy.** Import like SQLite. No server process, no wire protocol, no ops.
2. **Purpose-built, not general-purpose.** We build what real workloads need. No speculative features.
3. **Proven foundations.** Storage is delegated to battle-tested engines (RocksDB). We build graph semantics on top.
4. **TypeScript-native.** Fluent API, full type safety, no query language needed. Your IDE is your query tool.
5. **Auditable.** Every line readable. Small codebase = smaller attack surface = faster authorization.

## Specializations

**TwinGraph** (coming) — a PolyGraph specialization for digital twin applications, with pre-defined schemas for persona, memory, insight, and habit management, plus lifecycle integration for born/alive/sleeping/archived twin states.

## Status & Roadmap

**v0.1 — Core Engine MVP** ✅ *(current)*

- 166 tests passing, 93% statement / 98% function coverage
- 100-transaction audit workload completes in ~25ms

**v0.2 — Persistent Storage** 🔨 *(next)*
- RocksDB adapter, WAL crash recovery, backup/restore, npm publish

**v0.3 — TwinGraph Specialization**
- Digital twin schema, lifecycle, memory/insight operations, Neo4j migration tooling

**v0.4 — Hardening & Server Mode**
- REST/gRPC wrapper, health/metrics, auth, connection pooling

**v0.5 — Query Language**
- Cypher subset parser, query planner, REPL

See **[ROADMAP.md](ROADMAP.md)** for the full plan, design rationale, and future directions.

## Architecture

```
┌─────────────────────────────────────────────┐
│              Your Application                │
├─────────────────────────────────────────────┤
│         TwinGraph (optional layer)           │
├─────────────────────────────────────────────┤
│               PolyGraph Engine               │
│  Graph API · Traversal · Indexes · Tx Mgr   │
├─────────────────────────────────────────────┤
│            Storage Adapter                   │
│   MemoryAdapter (default) │ RocksDB (soon)  │
└─────────────────────────────────────────────┘
```

**Key design:** Index-free adjacency. Outgoing and incoming relationships are stored directly with the node via sorted key prefixes, making neighbor traversal O(neighbors) with no index hop. This is the same principle that makes Neo4j fast — we just implement it on our terms.

## License

Apache 2.0 — use it, modify it, own it.

## Contributing

This is a young project. Issues, ideas, and PRs are welcome. If you're working in a government or regulated environment and need a graph database you can authorize, we'd especially love to hear from you.
