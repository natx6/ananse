import { tool } from "ai";
import { z } from "zod";
import { confirm, isCancel } from "@clack/prompts";
import picocolors from "picocolors";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

export interface Plan {
  title: string;
  steps: PlanStep[];
  risk: "low" | "medium" | "high";
  estimatedImpact: string;
}

export interface PlanStep {
  action: string;
  target: string;
  description: string;
}

let pendingPlan: Plan | null = null;

/**
 * Display a plan to the user in a formatted box.
 */
export function displayPlan(plan: Plan): void {
  const riskColor = plan.risk === "high" ? picocolors.red
    : plan.risk === "medium" ? picocolors.yellow
    : picocolors.green;

  console.log(picocolors.cyan(`\n  ╭── Mission Plan: ${picocolors.white(plan.title)} ───`));
  console.log(`  ├── Risk: ${riskColor(plan.risk.toUpperCase())}`);
  console.log(`  ├── Impact: ${picocolors.dim(plan.estimatedImpact)}`);
  console.log(`  ├── Steps:`);
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const isLast = i === plan.steps.length - 1;
    const prefix = isLast ? "  └──" : "  ├──";
    console.log(`  │   ${picocolors.dim(`${i + 1}.`)} ${picocolors.white(step.action)} ${picocolors.dim(step.target)}`);
    console.log(`  │      ${picocolors.dim(step.description)}`);
  }
  console.log(picocolors.cyan(`  └────────────────────────────────────────────`));
}

/**
 * Prompt the user to approve or reject a plan.
 */
export async function requestPlanApproval(plan: Plan): Promise<boolean> {
  pendingPlan = plan;
  displayPlan(plan);

  const result = await confirm({
    message: "Approve this plan?",
  });

  if (isCancel(result) || result === false) {
    console.log(picocolors.yellow("\n  Plan rejected.\n"));
    pendingPlan = null;
    return false;
  }

  console.log(picocolors.green("\n  Plan approved.\n"));
  pendingPlan = null;
  return true;
}

/**
 * Create the submit_plan tool for the agent to signal plan readiness.
 */
export function createSubmitPlanTool() {
  return tool({
    description: "Submit a plan for user approval. Call this BEFORE executing any multi-step operation. The plan will be displayed and the user can approve or reject.",
    inputSchema: z.object({
      title: z.string().describe("Short title for the plan"),
      steps: z.array(z.object({
        action: z.string().describe("Action type: read, write, edit, command, search"),
        target: z.string().describe("Target file path or command"),
        description: z.string().describe("What this step accomplishes"),
      })).describe("Ordered list of steps"),
      risk: z.enum(["low", "medium", "high"]).describe("Overall risk level"),
      estimatedImpact: z.string().describe("What files or systems will be affected"),
    }),
    execute: async (input): Promise<ToolResult> => {
      const plan: Plan = {
        title: input.title,
        steps: input.steps,
        risk: input.risk,
        estimatedImpact: input.estimatedImpact,
      };

      const approved = await requestPlanApproval(plan);
      if (!approved) {
        return { success: false, data: "", error: "Plan rejected by user" };
      }

      return {
        success: true,
        data: `Plan approved. Execute the following steps:\n${plan.steps.map((s, i) => `${i + 1}. ${s.action}: ${s.target}`).join("\n")}`,
      };
    },
  });
}

registerTool("submit_plan", "core");
