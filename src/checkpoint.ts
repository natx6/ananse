import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

const execAsync = promisify(execFile);

/**
 * Create a git checkpoint before making risky changes.
 * Stashes uncommitted changes and returns the stash name.
 */
export function createCheckpointTool() {
  return tool({
    description: "Create a git checkpoint (auto-stash) before making risky changes. Run this before destructive operations to enable rollback.",
    inputSchema: z.object({
      message: z.string().describe("Description of what's about to change"),
    }),
    execute: async ({ message }): Promise<ToolResult> => {
      try {
        // Check if we're in a git repo
        await execAsync("git", ["rev-parse", "--git-dir"], { timeout: 5000 });
      } catch {
        return { success: false, data: "", error: "Not a git repository. Cannot create checkpoint." };
      }

      try {
        // Check for uncommitted changes
        const { stdout: status } = await execAsync("git", ["status", "--porcelain"], { timeout: 5000 });
        if (!status.trim()) {
          return { success: true, data: "Working tree is clean — no checkpoint needed." };
        }

        // Stash with a descriptive message
        const stamp = Date.now().toString(36);
        const label = `ananse-checkpoint-${stamp}: ${message.slice(0, 80)}`;
        await execAsync("git", ["stash", "push", "-m", label, "--include-untracked"], { timeout: 10000 });

        return {
          success: true,
          data: `Checkpoint created: "${label}"\nRun "git stash list" to see it.\nRun "git stash pop" to restore.\nRun "git stash drop $(git stash list | grep '${stamp}' | head -1 | cut -d: -f1)" to discard.`,
        };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

registerTool("checkpoint", "core");
