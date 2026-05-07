# Why PolyGraph?

*You need a graph database. You also need to authorize it.*

Every graph database on the market was built to be powerful. PolyGraph was built to be *ownable*.

---

## The Problem

You're building something that thinks in connections — audit chains, supply networks, knowledge graphs, digital twins. You need a graph database. So you evaluate the options:

**Neo4j** — powerful, proven, and the license will give your contracting officer heartburn. No FedRAMP ATO. No trajectory toward one. Your security team just added 6 months to your timeline.

**AWS Neptune** — FedRAMPed, but now you're locked to AWS, speaking Gremlin instead of Cypher, and paying per-IO on a service you can't take with you.

**Memgraph, FalkorDB, TigerGraph** — server processes, operational complexity, more infrastructure to authorize. You wanted a graph database, not a deployment problem.

You just needed to store nodes and traverse relationships. Why does this require a procurement cycle?

---

## The Answer

```bash
npm install polygraph-db
```

That's it. No server. No license negotiation. No vendor dependency. No ATO package to assemble for someone else's software.

PolyGraph is a **library**. It embeds in your application like SQLite. You import it, create your graph, traverse it, persist it to disk. Two dependencies, both permissive open-source (MIT + BSD). Your entire graph database is 31 KB.

---

## The Comparison

|  | PolyGraph | Neo4j Community | AWS Neptune |
|---|---|---|---|
| **Install** | `npm install` (2 sec) | Docker + config (30 min) | CloudFormation (hours) |
| **Runtime** | In-process | Separate JVM server | Managed service |
| **Node reads** | 864,000/sec | ~100,000/sec | Network-bound |
| **Node creates** | 181,000/sec | ~30,000/sec | Network-bound |
| **Memory (10K nodes)** | 12.5 MB | ~200 MB (JVM) | N/A (server-side) |
| **Package size** | 31 KB | 600 MB | N/A |
| **Runtime dependencies** | 2 | Entire JVM ecosystem | AWS SDK |
| **License** | Apache 2.0 | GPL + commercial | Proprietary service |
| **FedRAMP** | You own it — *you* authorize it | Not authorized | Yes (AWS) |
| **NIST 800-53** | 60 tests mapped to 15 controls | You write those yourself | AWS responsibility |
| **Vendor lock-in** | None | License terms | AWS |
| **Query language** | TypeScript (native) | Cypher | Gremlin / SPARQL |
| **Offline / air-gap** | Yes | Yes | No |
| **Source auditable** | Every line | Community edition only | No |

*Neo4j numbers are typical community benchmarks; PolyGraph numbers from built-in benchmark suite on Apple M-series.*

---

## Who It's For

**Government teams** who've been told "just use Neo4j" and then spent 8 months explaining to assessors why a GPL-licensed, non-FedRAMPed Java application should be in their authorization boundary.

**Defense contractors** who need graph intelligence at IL4/5 and can't wait for a vendor who may never get there.

**Startups** who want graph power without graph infrastructure. Your app is one process. Your database should be too.

**AI and digital twin builders** who need graph-native knowledge stores without the ops burden of running a database server next to their model.

---

## What You Get

- **Labeled property graph** — the same model as Neo4j. Nodes, labels, properties, typed relationships.
- **Fluent traversal API** — `.outgoing('KNOWS').where({ age: { $gt: 30 } }).depth(3).collect()`
- **Shortest path** — BFS and Dijkstra, built in.
- **Persistent storage** — LevelDB adapter. Data survives restarts.
- **284 tests** — functional, security (NIST 800-53 mapped), benchmarks, persistence.
- **Pure TypeScript** — your IDE is your query tool. No query language to learn.
- **90/10 architecture** — pure functions for logic, thin I/O shell for storage. Every line auditable.

---

## What You Don't Get (On Purpose)

No clustering. No sharding. No LDAP. No Kerberos. No enterprise admin console. No 50 APOC procedures you'll never touch.

Every feature we *don't* have is a feature your assessor doesn't have to evaluate, your ops team doesn't have to patch, and your attackers can't exploit.

**Smaller surface area = faster authorization = faster to production.**

---

## The Bottom Line

PolyGraph doesn't compete with Neo4j on features. It competes on **time to authorized production**.

If you need a graph database you can read every line of, ship in a single process, authorize on your own terms, and own forever — that's us.

**Apache 2.0. Use it, modify it, own it.**
