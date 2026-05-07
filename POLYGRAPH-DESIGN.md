# PolyGraph — Design Document v0.1

**A purpose-built, embeddable graph engine for government-ownable intelligence applications.**

*Created: 2026-05-07 | Author: Bhai (Digital Twin of William Fredricks)*

---

## 1. Executive Summary

PolyGraph is a lightweight, embeddable labeled property graph engine designed for mission-critical applications where vendor independence and government ownership of infrastructure are non-negotiable. It provides the graph storage, traversal, and query capabilities required by intelligence and audit applications without the operational complexity, licensing constraints, or FedRAMP gaps of commercial graph databases.

**TwinGraph** is the first specialization of PolyGraph, optimized for the User Digital Twin (UDT) application — adding schema conventions, lifecycle semantics, and traversal patterns specific to digital twin workloads.

### Why Now

1. **FedRAMP reality:** Neo4j has no FedRAMP ATO and shows no trajectory toward one. AWS Neptune is FedRAMPed but imposes vendor lock-in and a different query model (Gremlin/SPARQL).
2. **We already own the abstraction:** The GraphWriter serialization pattern, tiered processing, and programmatic query layer mean Neo4j is already behind our own coordination layer. The seam exists.
3. **Government ownership:** A purpose-built, open-source graph engine with no commercial licensing means the government owns the institutional memory infrastructure outright.
4. **Attack surface:** Smaller codebase = faster ATO. No unused enterprise features to audit, patch, or authorize.

### Naming

- **PolyGraph** — the general-purpose graph engine (poly = many forms; also: truth-detection for audit contexts)
- **TwinGraph** — the UDT-specialized fork with twin-native schema, lifecycle, and traversal semantics

---

## 2. Design Principles

### 2.1 Embed, Don't Deploy

PolyGraph is a **library**, not a server. Import it like SQLite. No separate process, no wire protocol (initially), no ops burden. A thin server wrapper is a later-phase addition for multi-process access.

### 2.2 Purpose-Built, Not General-Purpose

We build what we use. No speculative features. Every capability must trace to a real workload (AuditInsight, UDT, SIG). If we don't have a test for it, we don't build it.

### 2.3 Proven Foundations

Storage is delegated to RocksDB (BSD-licensed, battle-tested, embedded). We build graph semantics on top — not a storage engine from scratch. This is the same approach used by DGraph, JanusGraph, TigerGraph, and others.

### 2.4 TypeScript-Native API First

No query language to start. Programmatic traversal API in TypeScript. This matches how we actually query — our code is programmatic, not ad-hoc. A Cypher subset parser is a later-phase addition for analyst tooling.

### 2.5 The Lite* Pattern

Follows the established pattern: LiteBB (blackboard), LiteLLM (model proxy). Minimal, purpose-built, government-ownable.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────┐
│                  Application                     │
│         (AuditInsight / UDT / SIG)              │
├─────────────────────────────────────────────────┤
│              TwinGraph (optional)                 │
│   Twin schema · Lifecycle · Specialized queries  │
├─────────────────────────────────────────────────┤
│                   PolyGraph                       │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Graph API │ │   Tx Mgr │ │  Index Engine  │  │
│  │           │ │          │ │                │  │
│  │ • nodes   │ │ • WAL    │ │ • label index  │  │
│  │ • edges   │ │ • MVCC   │ │ • prop index   │  │
│  │ • traverse│ │ • snap-  │ │ • full-text    │  │
│  │ • query   │ │   shot   │ │   (optional)   │  │
│  │ • algo    │ │ • commit │ │ • composite    │  │
│  │           │ │ • abort  │ │                │  │
│  └───────────┘ └──────────┘ └────────────────┘  │
│  ┌─────────────────────────────────────────────┐ │
│  │             Storage Adapter                  │ │
│  │  RocksDB (default) | Memory (test/dev)      │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 3.1 Storage Layer

**Adapter pattern** with two implementations:

| Adapter | Use Case | Persistence | Performance |
|---------|----------|-------------|-------------|
| `RocksDBAdapter` | Production, benchmarks | Disk (LSM-tree) | High |
| `MemoryAdapter` | Unit tests, ephemeral | RAM only | Highest |

**Key design:** Nodes and relationships stored as RocksDB key-value pairs with carefully designed key prefixes for efficient range scans.

#### Key Schema (RocksDB)

```
n:{nodeId}                    → NodeRecord (labels, properties)
n:{nodeId}:l:{label}          → (exists marker for label index)
n:{nodeId}:o:{relType}:{relId} → RelationshipRecord (outgoing adjacency)
n:{nodeId}:i:{relType}:{relId} → RelationshipRecord (incoming adjacency)
r:{relId}                     → RelationshipRecord (type, startNode, endNode, properties)
i:l:{label}:{nodeId}          → (label index: find all nodes by label)
i:p:{label}:{propKey}:{value}:{nodeId} → (property index)
m:nextNodeId                  → counter
m:nextRelId                   → counter
```

**Why this key design:**
- `n:{id}:o:{type}:` prefix scan = all outgoing relationships of a type → **index-free adjacency**
- `i:l:{label}:` prefix scan = all nodes with a label → **label lookup**
- `i:p:{label}:{key}:{value}:` prefix scan = **property index**
- Adjacency stored with the node = traversal never needs a separate index hop

### 3.2 Graph API

The primary interface. TypeScript-native, fluent, composable.

```typescript
interface PolyGraph {
  // Node operations
  createNode(labels: string[], properties?: Record<string, any>): Promise<Node>;
  getNode(id: NodeId): Promise<Node | null>;
  updateNode(id: NodeId, properties: Record<string, any>): Promise<Node>;
  deleteNode(id: NodeId): Promise<void>;
  findNodes(label: string, filter?: PropertyFilter): Promise<Node[]>;

  // Relationship operations
  createRelationship(
    startNode: NodeId,
    endNode: NodeId,
    type: string,
    properties?: Record<string, any>
  ): Promise<Relationship>;
  getRelationship(id: RelId): Promise<Relationship | null>;
  deleteRelationship(id: RelId): Promise<void>;

  // Traversal
  traverse(startNode: NodeId): TraversalBuilder;
  shortestPath(from: NodeId, to: NodeId, options?: PathOptions): Promise<Path | null>;
  neighborhood(node: NodeId, depth: number, options?: NeighborhoodOptions): Promise<Subgraph>;

  // Transaction
  beginTx(): Transaction;
  withTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;

  // Index management
  createIndex(label: string, propertyKey: string): Promise<void>;
  dropIndex(label: string, propertyKey: string): Promise<void>;

  // Algorithms (plug-in)
  algo: AlgorithmRegistry;

  // Lifecycle
  open(path: string, options?: OpenOptions): Promise<void>;
  close(): Promise<void>;
  snapshot(): Promise<ReadableStream>;  // for backup
}
```

#### Traversal Builder (Fluent API)

```typescript
// Example: AuditInsight chain walking
const chain = await graph
  .traverse(startTxn)
  .outgoing('LINKED_TO')
  .where({ confidence: { $gte: 0.8 } })
  .depth(10)
  .collect();

// Example: UDT persona inheritance
const persona = await graph
  .traverse(userId)
  .outgoing('HAS_PERSONA')
  .outgoing('INHERITS_FROM')
  .depth(3)
  .collectTree();

// Example: SIG neighborhood
const neighbors = await graph
  .neighborhood(solutionNode, 2, {
    relationshipTypes: ['DEPENDS_ON', 'INTEGRATES_WITH'],
    direction: 'both'
  });
```

### 3.3 Transaction Manager

**Write-Ahead Log (WAL) + Snapshot Isolation**

- Every write goes to WAL first, then applied to RocksDB
- Readers see a consistent snapshot (no dirty reads)
- Single-writer model (matches our GraphWriter serialization pattern)
- RocksDB WriteBatch for atomic multi-key writes

```typescript
await graph.withTx(async (tx) => {
  const node = await tx.createNode(['Transaction'], { amount: 1500 });
  const link = await tx.createRelationship(node.id, clusterHead, 'BELONGS_TO');
  // atomic commit or full rollback
});
```

**Why single-writer is fine for us:** Our GraphWriter already serializes writes. We're not fighting the model — we're codifying it.

### 3.4 Index Engine

Three index types, all backed by RocksDB key prefixes:

| Index Type | Purpose | Key Pattern |
|-----------|---------|-------------|
| **Label** | Find all nodes by label | `i:l:{label}:{nodeId}` |
| **Property** | Find by label + property value | `i:p:{label}:{prop}:{value}:{nodeId}` |
| **Composite** | Multi-property lookup | `i:c:{label}:{prop1}:{val1}:{prop2}:{val2}:{nodeId}` |

Indexes are maintained synchronously on write (within the same transaction). No eventual consistency.

### 3.5 Algorithm Registry

Plug-in pattern. Ship with core algorithms, add as needed.

**Phase 1 (MVP):**
- Shortest path (Dijkstra, BFS)
- Neighborhood / ego graph
- Connected components
- Degree centrality

**Phase 2 (As needed):**
- PageRank
- Community detection (Louvain)
- Betweenness centrality
- Weakly/strongly connected components

```typescript
graph.algo.register('pagerank', pageRankImpl);
const scores = await graph.algo.run('pagerank', { dampingFactor: 0.85 });
```

---

## 4. TwinGraph Specialization

TwinGraph extends PolyGraph with UDT-specific conventions:

### 4.1 Schema Conventions

```typescript
// Pre-defined labels
type TwinLabels =
  | 'Twin' | 'Persona' | 'Preference' | 'Memory'
  | 'Insight' | 'KPI' | 'Event' | 'Document'
  | 'Habit' | 'Goal' | 'Contact' | 'Skill';

// Pre-defined relationship types
type TwinRelTypes =
  | 'HAS_PERSONA' | 'INHERITS_FROM' | 'REMEMBERS'
  | 'LEARNED_FROM' | 'PREFERS' | 'TRACKS_KPI'
  | 'KNOWS_ABOUT' | 'OBSERVED' | 'RELATES_TO';
```

### 4.2 Lifecycle Integration

```typescript
interface TwinGraph extends PolyGraph {
  // Twin-specific operations
  createTwin(config: TwinConfig): Promise<TwinNode>;
  getTwinState(): Promise<TwinState>;

  // Memory operations
  remember(event: MemoryEvent): Promise<MemoryNode>;
  recall(query: RecallQuery): Promise<MemoryNode[]>;
  forget(criteria: ForgetCriteria): Promise<number>;

  // Insight operations
  recordInsight(insight: Insight): Promise<InsightNode>;
  getInsightHistory(filter?: InsightFilter): Promise<InsightNode[]>;

  // Learning loop integration
  proposeHabit(pattern: ObservedPattern): Promise<HabitProposal>;
  promoteHabit(proposalId: NodeId): Promise<HabitNode>;
}
```

### 4.3 Migration Path

The transition from Neo4j to TwinGraph should be incremental:

1. **Adapter phase:** TwinGraph implements the same interface our code already uses through the GraphWriter abstraction
2. **Dual-write phase:** Write to both Neo4j and TwinGraph, read from Neo4j
3. **Shadow-read phase:** Read from both, compare results, flag discrepancies
4. **Cutover phase:** Read from TwinGraph, stop writing to Neo4j
5. **Retirement:** Remove Neo4j dependency

---

## 5. Performance Targets

Based on our actual workloads:

| Operation | Target | Notes |
|-----------|--------|-------|
| Node create | < 0.1ms | Single RocksDB write batch |
| Node lookup by ID | < 0.05ms | Direct key lookup |
| Label scan (1K nodes) | < 5ms | Prefix scan |
| Property index lookup | < 1ms | Prefix scan |
| Traverse depth-1 (100 neighbors) | < 2ms | Adjacency list scan |
| Traverse depth-3 (1K nodes) | < 20ms | BFS with adjacency |
| Shortest path (10K graph) | < 50ms | Dijkstra |
| AuditInsight: 4K txns full link | < 30s | Current Neo4j: ~30s |
| UDT: persona resolution | < 5ms | 3-hop traversal |
| Write tx (10 operations) | < 1ms | WAL + WriteBatch |

**Scale targets for Phase 1:**
- Up to 1M nodes, 10M relationships
- Single-process, single-machine
- These numbers cover all our current and projected workloads

---

## 6. Implementation Plan

### Phase 1 — Core Engine (MVP) — ~3 weeks

**Goal:** PolyGraph runs AuditInsight's 4,000-transaction linking workload.

| Week | Deliverable |
|------|-------------|
| 1 | Storage adapters (Memory + RocksDB), Node/Relationship CRUD, Label + Property indexes |
| 2 | Transaction manager (WAL + snapshot isolation), Traversal builder, Neighborhood/shortest-path |
| 3 | AuditInsight adapter (swap Neo4j driver for PolyGraph), Full regression test, Benchmarks |

**Exit criteria:**
- AuditInsight 4K-txn workload produces identical results to Neo4j
- Performance within 2x of Neo4j (faster expected for our access patterns)
- 90%+ test coverage
- Zero external service dependencies

### Phase 2 — TwinGraph + UDT Migration — ~3 weeks

**Goal:** UDT runs on TwinGraph instead of Neo4j.

| Week | Deliverable |
|------|-------------|
| 4 | TwinGraph schema layer, Twin lifecycle operations, Memory/Insight/Habit APIs |
| 5 | Dual-write adapter, Shadow-read comparison, Migration tooling |
| 6 | UDT full regression on TwinGraph, Docker compose without Neo4j container |

**Exit criteria:**
- UDT full test suite passes against TwinGraph
- Docker compose drops Neo4j container
- No regressions in functionality or performance

### Phase 3 — Hardening + Server — ~2 weeks

**Goal:** Production-ready with optional server mode.

| Week | Deliverable |
|------|-------------|
| 7 | Backup/restore (snapshot + WAL replay), Compaction strategy, Error recovery |
| 8 | Optional REST/gRPC server wrapper, OpenAPI spec, Health endpoint, Metrics |

### Phase 4 — Query Language (Future)

**Goal:** Cypher subset for analyst tooling and dashboards.

- openCypher parser (Apache 2.0 grammar)
- Subset: MATCH, WHERE, RETURN, WITH, ORDER BY, LIMIT
- Not needed until we have non-programmatic users (analysts, dashboards)

---

## 7. Technology Choices

| Component | Choice | License | Rationale |
|-----------|--------|---------|-----------|
| Language | TypeScript | — | Matches all our applications |
| Storage | RocksDB (via `rocksdb` npm) | BSD | Battle-tested, embedded, no server |
| Serialization | MessagePack (`msgpackr`) | MIT | Faster + smaller than JSON for properties |
| Testing | Vitest | MIT | Matches our test infrastructure |
| Build | tsup / esbuild | MIT | Fast, simple |

**Why TypeScript, not Rust/C++?**
- Our entire stack is TypeScript. One language = one team.
- RocksDB does the performance-critical I/O in C++ already.
- TypeScript overhead is in the graph logic layer, not the storage layer.
- If we ever need a Rust core, we can FFI/NAPI to it. But prove the need first.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RocksDB npm binding instability | Low | High | `rocksdb` npm package is mature (Level/community). Fallback: `classic-level` |
| Performance insufficient at scale | Low | Medium | Our scale is modest (< 1M nodes). RocksDB is the fast path. |
| Missing Neo4j feature we forgot about | Medium | Low | Adapter pattern means we can add features incrementally |
| Cypher compatibility harder than expected | Medium | Medium | We don't need Cypher for MVP. TypeScript API is the primary interface |
| RocksDB FedRAMP questions | Low | Medium | RocksDB is a component, not a service. No ATO needed for embedded libs. Already in FedRAMPed systems (CockroachDB, TiKV) |

---

## 9. Relationship to Existing Papers

PolyGraph strengthens several arguments in the paper suite:

- **SIG-DRIVEN-DEVELOPMENT.md:** The SIG can run on government-owned infrastructure with zero commercial graph DB licensing
- **SOLUTION-INTELLIGENCE-GRAPH.md:** "The graph IS the institutional memory" — now the institution owns the engine too
- **AGENTIC-OM-STORY.md:** Agentic operations can embed the graph engine directly, no external service dependency
- **COOP argument:** "We built it, we own it, we can authorize it" is the strongest possible FedRAMP position

---

## 10. Open Questions

1. **Should PolyGraph be a separate repo or a module within UDT?** Recommendation: separate repo (`polygraph/`), imported as dependency. Keeps it reusable.
2. **Do we need multi-process access for Phase 1?** No — single-process embedded is sufficient. Server wrapper is Phase 3.
3. **RDF/SPARQL support?** Not for PolyGraph. That's a different paradigm. If needed, build a separate adapter.
4. **Should we publish to npm?** Eventually, yes. Government-ownable open-source graph engine is a compelling offering.
5. **Name collision?** "PolyGraph" — need to check npm/GitHub for conflicts.

---

*This document follows the "always do the design doc" principle. Design first, then build.*
