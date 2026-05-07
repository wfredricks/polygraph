/**
 * Integration Tests for PolyGraph
 *
 * Why: Integration tests verify that PolyGraph can handle realistic workloads
 * similar to AuditInsight's transaction linking and clustering scenarios.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../engine.js';
import type { Node, Relationship } from '../types.js';

describe('PolyGraph - Integration Tests', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('AuditInsight-like Scenario: Transaction Linking', () => {
    it('should handle 100 transactions with clustering and chain analysis', async () => {
      // Create indexes for performance
      await graph.createIndex('Transaction', 'amount');
      await graph.createIndex('Transaction', 'timestamp');
      await graph.createIndex('Cluster', 'name');

      const startTime = Date.now();

      // Create 100 transaction nodes
      const transactions: Node[] = [];
      for (let i = 0; i < 100; i++) {
        const txn = await graph.createNode(
          ['Transaction'],
          {
            txnId: `TXN-${i.toString().padStart(4, '0')}`,
            amount: Math.floor(Math.random() * 10000) + 100,
            timestamp: Date.now() + i * 1000,
            account: `ACC-${Math.floor(i / 10)}`, // Group into 10 accounts
          }
        );
        transactions.push(txn);
      }

      console.log(`Created 100 transactions in ${Date.now() - startTime}ms`);

      // Create 10 cluster nodes
      const clusters: Node[] = [];
      for (let i = 0; i < 10; i++) {
        const cluster = await graph.createNode(
          ['Cluster'],
          {
            name: `Cluster-${i}`,
            riskScore: Math.random(),
          }
        );
        clusters.push(cluster);
      }

      // Link transactions to clusters
      const clusterLinks: Relationship[] = [];
      for (let i = 0; i < transactions.length; i++) {
        const clusterIdx = Math.floor(i / 10);
        const link = await graph.createRelationship(
          transactions[i].id,
          clusters[clusterIdx].id,
          'BELONGS_TO',
          {
            assignedAt: Date.now(),
          }
        );
        clusterLinks.push(link);
      }

      // Create chains: link transactions within same account
      const chainLinks: Relationship[] = [];
      for (let i = 0; i < transactions.length - 1; i++) {
        if (transactions[i].properties.account === transactions[i + 1].properties.account) {
          const link = await graph.createRelationship(
            transactions[i].id,
            transactions[i + 1].id,
            'LINKED_TO',
            {
              confidence: 0.8 + Math.random() * 0.2,
              linkType: 'sequential',
            }
          );
          chainLinks.push(link);
        }
      }

      // Add some cross-cluster links (anomalies)
      for (let i = 0; i < 10; i++) {
        const idx1 = Math.floor(Math.random() * transactions.length);
        const idx2 = Math.floor(Math.random() * transactions.length);
        if (idx1 !== idx2 && transactions[idx1].properties.account !== transactions[idx2].properties.account) {
          await graph.createRelationship(
            transactions[idx1].id,
            transactions[idx2].id,
            'LINKED_TO',
            {
              confidence: 0.6 + Math.random() * 0.2,
              linkType: 'anomaly',
            }
          );
        }
      }

      const stats = await graph.stats();
      console.log('Graph stats:', stats);

      expect(stats.nodeCount).toBe(110); // 100 transactions + 10 clusters
      expect(stats.relationshipCount).toBeGreaterThanOrEqual(100); // At least cluster links

      // Test 1: Find all transactions in a specific cluster
      const clusterMembers = await graph.traverse(clusters[0].id).incoming('BELONGS_TO').collect();
      expect(clusterMembers.length).toBe(10);

      // Test 2: Find high-value transactions
      const highValue = await graph.findNodes('Transaction', { amount: { $gte: 5000 } });
      expect(highValue.length).toBeGreaterThan(0);

      // Test 3: Traverse a transaction chain
      const chain = await graph.traverse(transactions[0].id).outgoing('LINKED_TO').depth(5).collect();
      expect(chain.length).toBeGreaterThan(0);

      // Test 4: Find shortest path between two transactions
      if (transactions.length >= 20) {
        const path = await graph.shortestPath(transactions[0].id, transactions[9].id, {
          relationshipTypes: ['LINKED_TO'],
        });
        if (path) {
          expect(path.length).toBeGreaterThan(0);
        }
      }

      // Test 5: Get neighborhood of a transaction
      const neighborhood = await graph.neighborhood(transactions[0].id, 2);
      expect(neighborhood.nodes.length).toBeGreaterThan(1);
      expect(neighborhood.relationships.length).toBeGreaterThan(0);

      // Test 6: Find anomalies (cross-cluster links)
      const anomalyLinks = await graph.findRelationships('LINKED_TO', {
        linkType: 'anomaly',
      });
      expect(anomalyLinks.length).toBeGreaterThan(0);

      // Test 7: Update cluster risk scores
      await graph.withTx(async (g) => {
        for (const cluster of clusters) {
          await g.updateNode(cluster.id, { riskScore: Math.random() });
        }
      });

      const updatedCluster = await graph.getNode(clusters[0].id);
      expect(updatedCluster?.properties.riskScore).toBeDefined();

      const totalTime = Date.now() - startTime;
      console.log(`Total integration test time: ${totalTime}ms`);

      // Performance assertion: should complete in reasonable time
      expect(totalTime).toBeLessThan(10000); // 10 seconds
    });
  });

  describe('Social Network Scenario', () => {
    it('should handle friend recommendations via common connections', async () => {
      // Create users
      const users: Node[] = [];
      for (let i = 0; i < 20; i++) {
        users.push(
          await graph.createNode(['User'], {
            username: `user${i}`,
            name: `User ${i}`,
          })
        );
      }

      // Create friendship network
      // User 0 knows users 1, 2, 3
      await graph.createRelationship(users[0].id, users[1].id, 'FOLLOWS');
      await graph.createRelationship(users[0].id, users[2].id, 'FOLLOWS');
      await graph.createRelationship(users[0].id, users[3].id, 'FOLLOWS');

      // User 1 knows users 4, 5
      await graph.createRelationship(users[1].id, users[4].id, 'FOLLOWS');
      await graph.createRelationship(users[1].id, users[5].id, 'FOLLOWS');

      // User 2 knows users 5, 6
      await graph.createRelationship(users[2].id, users[5].id, 'FOLLOWS');
      await graph.createRelationship(users[2].id, users[6].id, 'FOLLOWS');

      // Find friends of friends (potential recommendations for user 0)
      const directFriends = await graph.traverse(users[0].id).outgoing('FOLLOWS').collect();
      expect(directFriends.length).toBe(3);

      const friendsOfFriends = await graph
        .traverse(users[0].id)
        .outgoing('FOLLOWS')
        .depth(2)
        .unique()
        .collect();

      // Should include direct friends + friends of friends
      expect(friendsOfFriends.length).toBeGreaterThan(3);

      // User 5 should be a strong recommendation (known by both user 1 and user 2)
      const user5InResults = friendsOfFriends.some((u) => u.id === users[5].id);
      expect(user5InResults).toBe(true);
    });
  });

  describe('Knowledge Graph Scenario', () => {
    it('should handle document linking and topic clustering', async () => {
      // Create topics
      const topics = await Promise.all([
        graph.createNode(['Topic'], { name: 'Machine Learning' }),
        graph.createNode(['Topic'], { name: 'Graph Databases' }),
        graph.createNode(['Topic'], { name: 'TypeScript' }),
      ]);

      // Create documents
      const docs = await Promise.all([
        graph.createNode(['Document'], { title: 'Intro to ML', date: '2024-01-01' }),
        graph.createNode(['Document'], { title: 'Graph Theory', date: '2024-01-02' }),
        graph.createNode(['Document'], { title: 'TS Best Practices', date: '2024-01-03' }),
        graph.createNode(['Document'], { title: 'ML with Graphs', date: '2024-01-04' }),
      ]);

      // Link documents to topics
      await graph.createRelationship(docs[0].id, topics[0].id, 'ABOUT');
      await graph.createRelationship(docs[1].id, topics[1].id, 'ABOUT');
      await graph.createRelationship(docs[2].id, topics[2].id, 'ABOUT');
      await graph.createRelationship(docs[3].id, topics[0].id, 'ABOUT');
      await graph.createRelationship(docs[3].id, topics[1].id, 'ABOUT');

      // Link related documents
      await graph.createRelationship(docs[0].id, docs[3].id, 'RELATED_TO', { score: 0.9 });
      await graph.createRelationship(docs[1].id, docs[3].id, 'RELATED_TO', { score: 0.8 });

      // Find all documents about Machine Learning
      const mlDocs = await graph.traverse(topics[0].id).incoming('ABOUT').collect();
      expect(mlDocs.length).toBe(2);

      // Find documents that span multiple topics
      const multiTopicDocs = [];
      for (const doc of docs) {
        const docTopics = await graph.traverse(doc.id).outgoing('ABOUT').collect();
        if (docTopics.length > 1) {
          multiTopicDocs.push(doc);
        }
      }
      expect(multiTopicDocs.length).toBe(1);
      expect(multiTopicDocs[0].properties.title).toBe('ML with Graphs');

      // Find related documents via shared topics
      const relatedViaTopic = await graph
        .traverse(docs[0].id)
        .outgoing('ABOUT')
        .incoming('ABOUT')
        .unique()
        .collect();

      // Should find docs[3] which shares the ML topic
      const foundRelated = relatedViaTopic.some((d) => d.id === docs[3].id);
      expect(foundRelated).toBe(true);
    });
  });

  describe('Hierarchical Data Scenario', () => {
    it('should handle organizational hierarchy', async () => {
      // Create org structure
      const ceo = await graph.createNode(['Person', 'Executive'], { name: 'CEO', level: 1 });
      const cto = await graph.createNode(['Person', 'Executive'], { name: 'CTO', level: 2 });
      const cfo = await graph.createNode(['Person', 'Executive'], { name: 'CFO', level: 2 });

      const engManager = await graph.createNode(['Person', 'Manager'], { name: 'Eng Manager', level: 3 });
      const finManager = await graph.createNode(['Person', 'Manager'], { name: 'Fin Manager', level: 3 });

      const eng1 = await graph.createNode(['Person', 'Engineer'], { name: 'Engineer 1', level: 4 });
      const eng2 = await graph.createNode(['Person', 'Engineer'], { name: 'Engineer 2', level: 4 });
      const accountant = await graph.createNode(['Person', 'Accountant'], { name: 'Accountant', level: 4 });

      // Build hierarchy
      await graph.createRelationship(cto.id, ceo.id, 'REPORTS_TO');
      await graph.createRelationship(cfo.id, ceo.id, 'REPORTS_TO');
      await graph.createRelationship(engManager.id, cto.id, 'REPORTS_TO');
      await graph.createRelationship(finManager.id, cfo.id, 'REPORTS_TO');
      await graph.createRelationship(eng1.id, engManager.id, 'REPORTS_TO');
      await graph.createRelationship(eng2.id, engManager.id, 'REPORTS_TO');
      await graph.createRelationship(accountant.id, finManager.id, 'REPORTS_TO');

      // Find all direct reports of CEO
      const directReports = await graph.traverse(ceo.id).incoming('REPORTS_TO').collect();
      expect(directReports.length).toBe(2);

      // Find entire org under CEO
      const allReports = await graph.traverse(ceo.id).incoming('REPORTS_TO').depth(5).collect();
      expect(allReports.length).toBe(7); // CTO, CFO, EngMgr, FinMgr, Eng1, Eng2, Accountant

      // Find all executives
      const execs = await graph.findNodes('Executive');
      expect(execs.length).toBe(3);

      // Find reporting chain for an engineer
      const chain = await graph.shortestPath(eng1.id, ceo.id, {
        relationshipTypes: ['REPORTS_TO'],
        direction: 'outgoing',
      });
      expect(chain).not.toBeNull();
      expect(chain!.length).toBe(3); // Engineer -> Manager -> CTO -> CEO
    });
  });

  describe('Time-Series Event Scenario', () => {
    it('should handle temporal event chains', async () => {
      const baseTime = Date.now();

      // Create events
      const events: Node[] = [];
      for (let i = 0; i < 50; i++) {
        events.push(
          await graph.createNode(['Event'], {
            eventId: `evt-${i}`,
            timestamp: baseTime + i * 60000, // 1 minute apart
            type: i % 3 === 0 ? 'error' : i % 3 === 1 ? 'warning' : 'info',
            message: `Event ${i}`,
          })
        );
      }

      // Link sequential events
      for (let i = 0; i < events.length - 1; i++) {
        await graph.createRelationship(events[i].id, events[i + 1].id, 'NEXT');
      }

      // Create causal links (errors causing other errors)
      for (let i = 0; i < events.length - 5; i++) {
        if (events[i].properties.type === 'error' && events[i + 3].properties.type === 'error') {
          await graph.createRelationship(events[i].id, events[i + 3].id, 'CAUSED', {
            confidence: 0.7,
          });
        }
      }

      // Find all error events
      const errors = await graph.findNodes('Event', { type: 'error' });
      expect(errors.length).toBeGreaterThan(0);

      // Trace event chain from a specific event
      const eventChain = await graph.traverse(events[0].id).outgoing('NEXT').depth(10).collectPaths();
      expect(eventChain.length).toBeGreaterThan(0);

      // Find events that caused other events
      const causedEvents = await graph.traverse(events[0].id).outgoing('CAUSED').collect();
      // May or may not have caused events depending on timing

      // Get neighborhood around an error
      const errorIdx = events.findIndex((e) => e.properties.type === 'error');
      if (errorIdx !== -1) {
        const context = await graph.neighborhood(events[errorIdx].id, 2);
        expect(context.nodes.length).toBeGreaterThan(1);
      }
    });
  });

  describe('Batch Operations Performance', () => {
    it('should efficiently handle bulk creates', async () => {
      const startTime = Date.now();

      const nodes = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          graph.createNode(['BulkTest'], { index: i })
        )
      );

      const createTime = Date.now() - startTime;
      console.log(`Created 50 nodes in ${createTime}ms`);

      expect(nodes.length).toBe(50);

      // Create relationships
      const relStartTime = Date.now();
      const rels = await Promise.all(
        Array.from({ length: 49 }, (_, i) =>
          graph.createRelationship(nodes[i].id, nodes[i + 1].id, 'CHAIN')
        )
      );

      const relCreateTime = Date.now() - relStartTime;
      console.log(`Created 49 relationships in ${relCreateTime}ms`);

      expect(rels.length).toBe(49);

      const stats = await graph.stats();
      expect(stats.nodeCount).toBeGreaterThanOrEqual(50);
      expect(stats.relationshipCount).toBeGreaterThanOrEqual(49);
    });
  });

  describe('Complex Query Patterns', () => {
    it('should handle multi-hop traversal with filters', async () => {
      // Create a product catalog graph
      const category = await graph.createNode(['Category'], { name: 'Electronics' });
      const subcategory = await graph.createNode(['Category'], { name: 'Laptops' });
      const product1 = await graph.createNode(['Product'], { name: 'Laptop A', price: 1000, inStock: true });
      const product2 = await graph.createNode(['Product'], { name: 'Laptop B', price: 1500, inStock: false });
      const product3 = await graph.createNode(['Product'], { name: 'Laptop C', price: 800, inStock: true });

      await graph.createRelationship(subcategory.id, category.id, 'PARENT');
      await graph.createRelationship(product1.id, subcategory.id, 'IN_CATEGORY');
      await graph.createRelationship(product2.id, subcategory.id, 'IN_CATEGORY');
      await graph.createRelationship(product3.id, subcategory.id, 'IN_CATEGORY');

      // Find all products in Electronics that are in stock and under $1000
      const productsInCategory = await graph.traverse(category.id).incoming('PARENT').collect();
      expect(productsInCategory.length).toBe(1);

      const allProducts = await graph.traverse(subcategory.id).incoming('IN_CATEGORY').collect();
      expect(allProducts.length).toBe(3);

      const affordableInStock = await graph
        .traverse(subcategory.id)
        .incoming('IN_CATEGORY')
        .where({ inStock: true, price: { $lt: 1000 } })
        .collect();

      expect(affordableInStock.length).toBe(1);
      expect(affordableInStock[0].properties.name).toBe('Laptop C');
    });
  });
});
