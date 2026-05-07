# PolyGraph Roadmap

*Last updated: 2026-05-07*

This roadmap reflects where we're headed. Timelines are estimates, not promises — we're building this alongside real workloads (audit intelligence, digital twins) so priorities shift as we learn what matters most.

---

## ✅ v0.1 — Core Engine (Complete)

*The foundation. Prove the model works.*

- [x] In-memory storage adapter with sorted prefix scanning
- [x] Labeled property graph: nodes, relationships, labels, properties
- [x] Full CRUD with cascade delete
- [x] Property indexes with automatic backfill
- [x] 11 filter operators ($eq, $neq, $gt, $gte, $lt, $lte, $in, $contains, $startsWith, $endsWith, $exists)
- [x] Fluent traversal builder (outgoing/incoming/both, where, depth, limit, unique)
- [x] Multi-step traversal chains with cyclic step reuse
- [x] Three collection modes: nodes, paths, subgraph
- [x] BFS + Dijkstra shortest path
- [x] Neighborhood extraction
- [x] Transaction support with serialized counters
- [x] 166 tests, 93% statement coverage

---

## 🔨 v0.2 — Persistent Storage

*Make it a real database. Data survives restarts.*

- [ ] **RocksDB adapter** — persistent storage using the same key schema as MemoryAdapter
- [ ] Write-ahead log (WAL) for crash recovery
- [ ] Compaction strategy tuning for graph access patterns
- [ ] Backup/restore: snapshot export + WAL replay
- [ ] Benchmark suite: PolyGraph vs Neo4j for equivalent workloads
- [ ] Publish to npm

**Why RocksDB:** BSD-licensed, battle-tested (powers CockroachDB, TiKV, and others), already present in FedRAMP-authorized systems as an embedded component. No separate server — it's a library, just like us.

---

## 🔨 v0.3 — TwinGraph Specialization

*The first domain-specific fork. Purpose-built for digital twin applications.*

- [ ] Pre-defined twin schema (Persona, Memory, Insight, Habit, KPI, Contact, Event, Document)
- [ ] Pre-defined relationship types (HAS_PERSONA, REMEMBERS, LEARNED_FROM, PREFERS, TRACKS_KPI)
- [ ] Twin lifecycle state machine (born → alive → sleeping → archived)
- [ ] Memory operations: remember, recall, forget
- [ ] Insight and learning loop integration
- [ ] Migration tooling from Neo4j (dual-write → shadow-read → cutover)

**Why a specialization:** Digital twins are the first real consumer of PolyGraph. Building TwinGraph proves the extensibility model and gives twin developers a head start.

---

## 📋 v0.4 — Hardening & Server Mode

*Production-ready. Optional multi-process access.*

- [ ] Error recovery and corruption detection
- [ ] Optional REST/gRPC server wrapper (for multi-process access)
- [ ] OpenAPI specification
- [ ] Health endpoint and metrics (Prometheus-compatible)
- [ ] Connection pooling for server mode
- [ ] Rate limiting and basic auth

---

## 📋 v0.5 — Query Language

*For humans, not just code. Analyst tooling and dashboards.*

- [ ] Cypher subset parser (leveraging openCypher's Apache 2.0 grammar)
- [ ] Supported: MATCH, WHERE, RETURN, WITH, ORDER BY, LIMIT, CREATE, DELETE
- [ ] Query planner that leverages existing indexes
- [ ] REPL / interactive query console
- [ ] Query explain/profile output

**Why Cypher:** It's the most widely known graph query language, the grammar is open-source, and our existing users (coming from Neo4j) already know it. We implement the subset people actually use, not the full spec.

---

## 🔭 Future — What We're Thinking About

These aren't committed — they're directions we're exploring based on real needs:

- **Graph algorithms library** — PageRank, community detection (Louvain), betweenness centrality, connected components. Plug-in architecture so you only load what you use.
- **Streaming/event integration** — NATS or similar for graph change events. Enable reactive patterns (twin observes graph changes, responds).
- **Multi-model support** — Document storage alongside graph (for cases where you need both but don't want two databases).
- **Browser/edge runtime** — PolyGraph already runs in-memory with zero native deps. A WebAssembly or pure-browser build could enable client-side graph intelligence.
- **Distributed mode** — Sharding and replication for large-scale deployments. This is the hardest problem and the one we'll tackle last (if ever — most government workloads don't need billions of nodes).

---

## How We Decide What's Next

1. **Does a real workload need it?** Every feature must trace to an actual use case (audit intelligence, digital twins, knowledge graphs). No speculative features.
2. **Does it make authorization easier or harder?** Smaller surface area = faster ATO. We don't add features that make the security story worse.
3. **Does it respect the embed-first principle?** Server mode is optional. The core must always work as a library.

---

## Get Involved

If you're working in government, defense, or regulated industries and have graph database needs that commercial products can't meet (authorization, air-gap, ownership), we want to hear from you. Open an issue, start a discussion, or just star the repo to signal interest.

The roadmap evolves based on what real users need. Your use case shapes what gets built next.
