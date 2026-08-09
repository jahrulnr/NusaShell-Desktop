import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FilesystemPromptLoader } from "../src/agent/filesystem-prompt-loader.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const promptsRoot = resolve(repositoryRoot, "resources", "agent", "prompts");

describe("background skill-review prompts", () => {
  it.each(["skill-review.md", "combined-review.md"])(
    "%s makes skill creation conditional and requires reading a related skill first",
    async (name) => {
      const content = await new FilesystemPromptLoader(promptsRoot).loadReviewPrompt(
        name === "skill-review.md" ? "skill" : "combined",
      );

      expect(content).toContain("Decide first whether the transcript contains a skill-worthy gap.");
      expect(content).toContain("read the closest matching skill with `skill_read`");
      expect(content.indexOf("Decide first whether")).toBeLessThan(content.indexOf("skill_manage"));
      expect(content.indexOf("skill_read")).toBeLessThan(content.indexOf("Use `skill_manage` only after"));
      expect(content).not.toContain("{{skill_review_rules}}");
    },
  );
});
