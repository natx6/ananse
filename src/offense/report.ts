import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { registerTool } from "../mode.js";
import type { ToolResult } from "../types.js";

const REPORTS_DIR = join(homedir(), ".ananse", "reports");

/**
 * Generate a penetration test report.
 */
export function createReportTool() {
  return tool({
    description: "Generate a penetration test report with findings, evidence, severity levels, and remediation recommendations. Saves the report to ~/.ananse/reports/.",
    inputSchema: z.object({
      title: z.string().describe("Report title (e.g., 'Internal Network Pentest — ACME Corp')"),
      target: z.string().describe("Target system or scope"),
      findings: z.array(z.object({
        type: z.string().describe("Vulnerability type (e.g., 'Privilege Escalation', 'Information Disclosure')"),
        severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]).describe("Severity level"),
        affected: z.string().describe("Affected file, service, or component"),
        description: z.string().describe("Detailed description of the finding"),
        remediation: z.string().describe("How to fix or mitigate this finding"),
        evidence: z.string().optional().describe("Command output or evidence supporting the finding"),
      })).describe("List of security findings"),
      summary: z.string().describe("Executive summary of the assessment"),
      riskScore: z.enum(["critical", "high", "medium", "low"]).describe("Overall risk score"),
    }),
    execute: async (input): Promise<ToolResult> => {
      const date = new Date().toISOString().split("T")[0];
      const critical = input.findings.filter((f) => f.severity === "CRITICAL").length;
      const high = input.findings.filter((f) => f.severity === "HIGH").length;
      const medium = input.findings.filter((f) => f.severity === "MEDIUM").length;
      const low = input.findings.filter((f) => f.severity === "LOW").length;

      const report = [
        `# Penetration Test Report: ${input.title}`,
        ``,
        `**Date:** ${date}`,
        `**Target:** ${input.target}`,
        `**Risk Score:** ${input.riskScore.toUpperCase()}`,
        ``,
        `## Executive Summary`,
        ``,
        input.summary,
        ``,
        `## Finding Summary`,
        ``,
        `| Severity | Count |`,
        `|----------|-------|`,
        `| CRITICAL | ${critical} |`,
        `| HIGH     | ${high} |`,
        `| MEDIUM   | ${medium} |`,
        `| LOW      | ${low} |`,
        ``,
        `## Findings`,
        ``,
      ].join("\n");

      const findingsMd = input.findings.map((f, i) => {
        return [
          `### ${i + 1}. [${f.severity}] ${f.type}`,
          ``,
          `**Affected:** ${f.affected}`,
          ``,
          `**Description:** ${f.description}`,
          ``,
          `**Remediation:** ${f.remediation}`,
          f.evidence ? `\n**Evidence:**\n\`\`\`\n${f.evidence}\n\`\`\`` : "",
          ``,
        ].join("\n");
      }).join("\n");

      const fullReport = report + findingsMd;

      // Save report
      await mkdir(REPORTS_DIR, { recursive: true });
      const filename = `pentest-${date}-${input.title.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40)}.md`;
      const filePath = join(REPORTS_DIR, filename);
      await writeFile(filePath, fullReport, "utf-8");

      return {
        success: true,
        data: `Report saved to ${filePath}\n\n${fullReport}`,
      };
    },
  });
}

registerTool("report", "offense");
