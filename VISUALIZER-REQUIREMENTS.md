# PolyGraph Visualizer — Requirements

**Product:** Ships with `polygraph-db` — any adopter gets visualization.
**Principle:** If you own the engine, own the viewer.
**Date:** 2026-05-07

---

## What Is This?

A browser-based graph visualizer that connects to any PolyGraph instance.
Not a database admin tool — a visual explorer for understanding what's
in the graph. Point it at a path, see the data.

Think: Neo4j Browser, but embeddable, no Java, ships with npm install.

---

## Design Principles

1. **Ships with the package.** `npx polygraph-viz` starts it. No separate install.
2. **Zero configuration.** Point at a LevelDB path or connect to a running instance.
3. **Read-only by default.** Explore, don't mutate. Optional write mode behind a flag.
4. **Works offline.** No CDN dependencies. Everything bundled.
5. **Embeddable.** Can be mounted as a route in any Express/Hono app.

---

## Requirements

### Connection

**REQ-VIZ-01: Connect to LevelDB path**
`npx polygraph-viz --path ./my-graph-data` opens the visualizer against
a LevelDB-backed PolyGraph. Read-only by default.

**REQ-VIZ-02: Connect to running PolyGraph API**
`npx polygraph-viz --url http://localhost:3000/api/graph` connects to
a twin or application that exposes the graph export endpoint.

**REQ-VIZ-03: Memory mode for demos**
`npx polygraph-viz --demo` starts with a sample graph pre-loaded.
Good for demos, docs, and README screenshots.

### Graph View

**REQ-VIZ-04: Force-directed layout**
Default view is a D3 force-directed graph. Nodes repel, edges attract.
Stabilizes after a few seconds. Draggable nodes.

**REQ-VIZ-05: Node coloring by label**
Each label gets a distinct color. Color legend in the corner.
Common labels: Twin (blue), Document (green), Role (orange), 
Principle (purple), Task (yellow).

**REQ-VIZ-06: Node sizing by degree**
Nodes with more connections are bigger. The most-connected nodes
are visually prominent.

**REQ-VIZ-07: Edge labels**
Relationship type shown on hover or always (configurable).
Edge color lighter than node colors.

**REQ-VIZ-08: Zoom + Pan**
Mouse wheel zoom. Click-drag to pan. Pinch zoom on touch devices.
Double-click node to center and zoom in.

**REQ-VIZ-09: Fullscreen toggle**
F11 or button for fullscreen. Good for presentations.

### Node Inspection

**REQ-VIZ-10: Click node → side panel**
Clicking a node opens a panel showing:
- Node ID
- All labels
- All properties (key-value table)
- Incoming relationships (count + types)
- Outgoing relationships (count + types)

**REQ-VIZ-11: Expand neighbors**
Button in the panel: "Expand" — loads and displays all connected nodes.
For large graphs, lazy-loading prevents rendering everything at once.

**REQ-VIZ-12: Collapse subtree**
Right-click node → "Collapse" hides all nodes reachable only through
this node. Cleans up the view.

### Search + Filter

**REQ-VIZ-13: Search by property**
Search box: type a property value, nodes matching highlight.
"Bill" highlights all nodes with any property containing "Bill".

**REQ-VIZ-14: Filter by label**
Checkboxes for each label in the graph. Uncheck a label → those nodes hide.
Relationships to hidden nodes also hide.

**REQ-VIZ-15: Filter by relationship type**
Same as label filter but for edges. Show only KNOWS relationships,
hide everything else.

**REQ-VIZ-16: Cypher query bar**
For power users: type a Cypher query, results render as a subgraph.
Uses PolyGraph's built-in Cypher bridge.
`MATCH (t:Twin)-[:HAS_IDENTITY]->(i) RETURN t, i`

### Layout Options

**REQ-VIZ-17: Multiple layouts**
- Force-directed (default)
- Hierarchical (top-down for tree-like graphs)
- Radial (from a selected center node)
- Grid (for large flat collections)

**REQ-VIZ-18: Layout persistence**
Node positions saved to localStorage. Reopening the visualizer
restores the last layout. Reset button available.

### Statistics

**REQ-VIZ-19: Stats panel**
Sidebar showing:
- Total nodes / relationships
- Label distribution (bar chart)
- Relationship type distribution
- Graph density
- Connected components count

### Export

**REQ-VIZ-20: Export as PNG/SVG**
Button to export current view as PNG or SVG. Good for docs and slides.

**REQ-VIZ-21: Export as JSON**
Export visible subgraph as { nodes, edges } JSON. Good for scripting.

### Embedding

**REQ-VIZ-22: Embeddable component**
The visualizer is also a React component:
```tsx
import { PolyGraphViz } from 'polygraph-db/viz';
<PolyGraphViz path="./data" />
```
Can be mounted in any React app (Next.js, Vite, CRA).

**REQ-VIZ-23: Hono/Express middleware**
```typescript
import { vizMiddleware } from 'polygraph-db/viz';
app.use('/graph', vizMiddleware({ path: './data' }));
```
Serves the visualizer as a route in any HTTP server.

---

## Use Cases

### UC-VIZ-01: Developer explores a twin's graph
```bash
npx polygraph-viz --path ./twin-graph-data
```
Opens browser → sees birthright, documents, team members, roles.
Clicks Twin node → sees identity properties. Expands → sees principles.

### UC-VIZ-02: Presenter demos PolyGraph
```bash
npx polygraph-viz --demo
```
Pre-loaded sample graph. Force-directed animation. Looks great on a projector.
Export as PNG for slides.

### UC-VIZ-03: Twin SPA embeds the viewer
```tsx
// In the twin's Next.js app
<PolyGraphViz url="/api/graph/export" />
```
Graph viewer as a page in the twin's UI. Same auth, same theme.

### UC-VIZ-04: Operator inspects production graph
```bash
npx polygraph-viz --url https://twin.credence.ai/api/graph
```
Remote inspection. Read-only. Search for specific nodes.

---

## Technology

| Component | Choice | Why |
|-----------|--------|-----|
| Rendering | D3.js + SVG | Interactive, accessible, no canvas complexity |
| UI framework | Vanilla HTML + minimal CSS | Ships with PolyGraph, no React dependency for CLI mode |
| Embeddable | React wrapper optional | For apps that use React |
| Server | Hono (bundled) | Same as the twin stack |
| Bundler | tsup (same as PolyGraph) | Consistent tooling |

### Package Structure

```
polygraph-db/
  dist/
    viz/
      index.html      ← standalone visualizer
      viz.js           ← bundled D3 + UI
      viz.css          ← styles
      component.js     ← React component (optional)
      middleware.js     ← Hono/Express middleware
  src/
    viz/
      server.ts        ← npx polygraph-viz entry point
      graph-api.ts     ← REST API for graph data
      renderer.ts      ← D3 force-directed renderer
      panel.ts         ← node inspection panel
      search.ts        ← search + filter
      stats.ts         ← statistics panel
      layouts.ts       ← layout algorithms
      types.ts         ← visualizer types
```

### CLI

```bash
npx polygraph-viz [options]

Options:
  --path <dir>     LevelDB directory to visualize
  --url <url>      Remote PolyGraph API URL
  --demo           Start with sample data
  --port <n>       HTTP port (default: 4444)
  --write          Enable write mode (mutations allowed)
  --open           Auto-open browser
```

---

## Differentiator

No other embeddable graph database ships with a visualizer.
SQLite has CLI. Neo4j has Browser (but requires Java server).
PolyGraph has `npx polygraph-viz` — zero dependencies, instant visual.

This is what makes PolyGraph feel like a **product**, not just a library.

---

*"If you can't see it, you can't trust it."*
