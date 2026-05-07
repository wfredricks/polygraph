# PolyGraph

**A purpose-built, embeddable graph engine for applications where you need to own the infrastructure.**

PolyGraph is a labeled property graph database that embeds into your application like SQLite — no separate server, no ops burden, no vendor licensing. Import it, create nodes and relationships, traverse your graph.

## Why PolyGraph?

Commercial graph databases are powerful but come with trade-offs:

- **Licensing constraints** that limit how you deploy and distribute
- **Operational complexity** of running a separate database server
- **Authorization gaps** when your environment requires certified infrastructure (FedRAMP, IL4/5, ATO)
- **Feature bloat** when you need 20% of what they offer but must authorize 100%

PolyGraph gives you the labeled property graph model you need with none of the baggage. Every line of code is auditable, modifiable, and ownable.

## Quick Start

```bash
npm install polygraph
```

```typescript
import { PolyGraph } from 'polygraph';

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

## Status

**v0.1 — Core Engine MVP**

- 166 tests passing
- 93% statement coverage, 98% function coverage
- 100-transaction audit workload completes in ~25ms

This is early. The foundation is solid and tested, but there's more to build:

- [ ] RocksDB persistent adapter
- [ ] TwinGraph specialization
- [ ] Backup/restore (snapshot + replay)
- [ ] Optional REST/gRPC server wrapper
- [ ] Cypher subset parser (for analyst tooling)
- [ ] Benchmarks against Neo4j for equivalent workloads

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
