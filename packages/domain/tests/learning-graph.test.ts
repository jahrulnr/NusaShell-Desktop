// Pure domain tests for the learning-graph primitives (ticket #84, Klaster E).

import { describe, expect, it } from "vitest";
import {
  buildGraphStats,
  buildMemoryNode,
  categoryForSkillId,
  clusterNodes,
  parseMemoryNodeId,
  parseRelatedSkills,
  truncate,
  type LearningNode,
} from "@nusashell/domain";

describe("domain learning-graph primitives", () => {
  describe("parseMemoryNodeId", () => {
    it("parses valid memory node ids", () => {
      expect(parseMemoryNodeId("memory:memory:0")).toEqual({ source: "memory", index: 0 });
      expect(parseMemoryNodeId("memory:user:3")).toEqual({ source: "user", index: 3 });
      expect(parseMemoryNodeId("memory:memory:42")).toEqual({ source: "memory", index: 42 });
    });

    it("rejects malformed ids", () => {
      expect(parseMemoryNodeId("memory")).toBeNull();
      expect(parseMemoryNodeId("memory:")).toBeNull();
      expect(parseMemoryNodeId("memory:x:0")).toBeNull();
      expect(parseMemoryNodeId("memory:memory:-1")).toBeNull();
      expect(parseMemoryNodeId("memory:memory:1.5")).toBeNull();
      expect(parseMemoryNodeId("skill:memory:0")).toBeNull();
      expect(parseMemoryNodeId("")).toBeNull();
    });
  });

  describe("parseRelatedSkills", () => {
    it("parses the block-list frontmatter form", () => {
      const content = `---\nname: alpha\ndescription: demo\nrelated_skills:\n  - bravo\n  - "charlie"\n---\n# Alpha\n`;
      expect(parseRelatedSkills(content)).toEqual(["bravo", "charlie"]);
    });

    it("parses the inline-array form", () => {
      const content = `---\nname: alpha\nrelated_skills: ["bravo", 'charlie', delta]\n---\n`;
      expect(parseRelatedSkills(content)).toEqual(["bravo", "charlie", "delta"]);
    });

    it("returns [] when there is no related_skills key", () => {
      const content = `---\nname: alpha\n---\nbody`;
      expect(parseRelatedSkills(content)).toEqual([]);
    });

    it("returns [] when there is no frontmatter", () => {
      expect(parseRelatedSkills("# no frontmatter\nbody")).toEqual([]);
    });
  });

  describe("buildMemoryNode", () => {
    it("shapes a memory node with truncated label and parsed timestamp", () => {
      const long = "x".repeat(80);
      const node = buildMemoryNode({ text: long, createdAt: "2026-08-01T00:00:00.000Z" }, "memory", 2);
      expect(node.id).toBe("memory:memory:2");
      expect(node.kind).toBe("memory");
      expect(node.label).toBe(truncate(long, 60));
      expect(node.timestamp).toBe(new Date("2026-08-01T00:00:00.000Z").getTime());
      expect(node.category).toBe("memory");
      expect(node.memorySource).toBe("memory");
    });

    it("keeps timestamp null for undated entries", () => {
      const node = buildMemoryNode({ text: "hi", createdAt: null }, "user", 0);
      expect(node.timestamp).toBeNull();
      expect(node.category).toBe("user");
      expect(node.memorySource).toBe("user");
    });
  });

  describe("categoryForSkillId", () => {
    it("derives the top-level category from a namespaced id", () => {
      expect(categoryForSkillId("frontend-design/readme")).toBe("frontend-design");
    });

    it("falls back to general for flat ids", () => {
      expect(categoryForSkillId("plain")).toBe("general");
    });
  });

  describe("clusterNodes / buildGraphStats", () => {
    const nodes: LearningNode[] = [
      buildMemoryNode({ text: "a", createdAt: null }, "memory", 0),
      buildMemoryNode({ text: "b", createdAt: null }, "user", 0),
      { id: "s1", label: "S1", kind: "skill", timestamp: null, category: "tooling", useCount: 3, state: "active", createdBy: "agent", pinned: false },
      { id: "s2", label: "S2", kind: "skill", timestamp: null, category: "tooling", useCount: 0, state: "active", createdBy: "user", pinned: false },
    ];

    it("clusters by category, most populated first", () => {
      expect(clusterNodes(nodes)).toEqual([
        { category: "tooling", count: 2 },
        { category: "memory", count: 1 },
        { category: "user", count: 1 },
      ]);
    });

    it("aggregates stats", () => {
      expect(buildGraphStats(nodes)).toEqual({
        skills: 2,
        learnedSkills: 1,
        memoryNodes: 2,
        agentCreated: 1,
        used: 1,
      });
    });
  });
});
