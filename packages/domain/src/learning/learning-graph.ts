/**
 * Learning-graph primitives — pure domain rules (ticket #84, Klaster E).
 *
 * Moved from `packages/application/src/learning/learning-graph-service.ts`.
 * Holds the node/edge/cluster/stat shapes, the memory-node id grammar, the
 * `related_skills` frontmatter parser, and the pure node-shaping helpers.
 * I/O (skill registry, usage, provenance, memory store) stays in the
 * application `LearningGraphService`.
 */

/** Structural view of a memory entry the graph can render (no port needed). */
export interface MemoryNodeEntry {
  readonly text: string;
  readonly createdAt: string | null;
}

export interface LearningNode {
  readonly id: string;
  readonly label: string;
  readonly kind: "skill" | "memory";
  readonly timestamp: number | null;
  readonly category: string;
  readonly useCount: number;
  readonly state: "active" | "stale" | "archived";
  readonly createdBy: "agent" | "user" | "builtin";
  readonly pinned: boolean;
  readonly memorySource?: "memory" | "user";
}

export interface LearningEdge {
  readonly source: string;
  readonly target: string;
}

export interface LearningCluster {
  readonly category: string;
  readonly count: number;
}

export interface LearningGraphStats {
  readonly skills: number;
  readonly learnedSkills: number;
  readonly memoryNodes: number;
  readonly agentCreated: number;
  readonly used: number;
}

export interface LearningGraph {
  readonly nodes: readonly LearningNode[];
  readonly edges: readonly LearningEdge[];
  readonly clusters: readonly LearningCluster[];
  readonly stats: LearningGraphStats;
}

export const MEMORY_NODE_ID_PATTERN = /^memory:(memory|user):\d+$/;

/** Parse a `memory:<source>:<index>` node id, or null when malformed. */
export function parseMemoryNodeId(nodeId: string): { source: "memory" | "user"; index: number } | null {
  const parts = nodeId.split(":");
  if (parts.length !== 3 || parts[0] !== "memory") return null;
  const source = parts[1] as "memory" | "user";
  if (source !== "memory" && source !== "user") return null;
  const index = Number(parts[2]);
  if (!Number.isInteger(index) || index < 0) return null;
  return { source, index };
}

/** Parse the `related_skills` list from a skill's SKILL.md frontmatter. */
export function parseRelatedSkills(content: string): string[] {
  const fm = extractFrontmatter(content);
  if (!fm) return [];
  const match = fm.match(/^related_skills:\s*\r?\n((?:\s*-\s+.+\r?\n?)+)/m);
  if (!match) {
    const inline = fm.match(/^related_skills:\s*\[(.+?)\]/m);
    if (!inline) return [];
    return inline[1]!
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s.length > 0);
  }
  const lines = match[1]!.split(/\r?\n/).filter((l) => l.trim().startsWith("-"));
  return lines
    .map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

/** Extract YAML frontmatter (between leading `---` markers), or null. */
export function extractFrontmatter(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const endMatch = content.slice(3).match(/\r?\n---/);
  if (!endMatch) return null;
  const end = endMatch.index! + 3;
  return content.slice(3, end);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Shape a memory node for the learning graph (pure). */
export function buildMemoryNode(
  entry: MemoryNodeEntry,
  source: "memory" | "user",
  index: number,
): LearningNode {
  const id = `memory:${source}:${index}`;
  const label = truncate(entry.text, 60);
  const timestamp = entry.createdAt ? new Date(entry.createdAt).getTime() : null;
  return {
    id,
    label,
    kind: "memory",
    timestamp: timestamp !== null && !Number.isNaN(timestamp) ? timestamp : null,
    category: source === "memory" ? "memory" : "user",
    useCount: 0,
    state: "active",
    createdBy: "agent",
    pinned: false,
    memorySource: source,
  };
}

/** Derive the graph category from a skill id (`a/b` → `a`, else `general`). */
export function categoryForSkillId(skillId: string): string {
  const parts = skillId.split("/");
  return parts.length > 1 ? parts[0]! : "general";
}

/** Cluster nodes by category, most populated first (pure). */
export function clusterNodes(nodes: readonly LearningNode[]): LearningCluster[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.category, (counts.get(node.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/** Aggregate graph statistics (pure). */
export function buildGraphStats(nodes: readonly LearningNode[]): LearningGraphStats {
  let skills = 0;
  let learnedSkills = 0;
  let memoryNodes = 0;
  let agentCreated = 0;
  let used = 0;

  for (const node of nodes) {
    if (node.kind === "skill") {
      skills++;
      if (node.createdBy === "agent") {
        learnedSkills++;
        agentCreated++;
      }
      if (node.useCount > 0) used++;
    } else {
      memoryNodes++;
    }
  }

  return { skills, learnedSkills, memoryNodes, agentCreated, used };
}
