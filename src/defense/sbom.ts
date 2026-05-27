import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import type { ToolResult } from "../types.js";

const SBOM_DIR = join(homedir(), ".ananse", "sbom");

/**
 * Generate an SBOM (Software Bill of Materials) for installed packages.
 */
export function createSbomGenerateTool() {
  return tool({
    description: "Generate a Software Bill of Materials (SBOM) listing all installed packages, their versions, and package managers used. Supports dpkg, rpm, npm, pip, and cargo.",
    inputSchema: z.object({
      format: z.enum(["simple", "detailed"]).optional().describe("Output format (default: simple)"),
    }),
    execute: async ({ format }): Promise<ToolResult> => {
      await mkdir(SBOM_DIR, { recursive: true });
      const parts: string[] = [];
      const isDetailed = format === "detailed";
      let totalPackages = 0;

      // dpkg (Debian-based)
      const dpkg = isDetailed
        ? await sh("dpkg -l 2>/dev/null | tail -n+6")
        : await sh("dpkg -l 2>/dev/null | tail -n+6 | awk '{print $2, $3}'");
      if (dpkg && !dpkg.startsWith("Error")) {
        const count = dpkg.split("\n").length;
        totalPackages += count;
        parts.push(`=== Debian Packages (${count}) ===`);
        if (!isDetailed) parts.push("(run with format: 'detailed' for full output)");
        parts.push(dpkg.split("\n").slice(0, 50).join("\n"));
        if (count > 50) parts.push(`... (${count - 50} more)`);
      }

      // rpm (RHEL-based)
      const rpm = await sh("rpm -qa 2>/dev/null | head -50");
      if (rpm && !rpm.startsWith("Error")) {
        const count = rpm.split("\n").length;
        totalPackages += count;
        parts.push(`\n=== RPM Packages (${count}) ===`);
        parts.push(rpm);
      }

      // npm global packages
      const npm = await sh("npm list -g --depth=0 2>/dev/null");
      if (npm && !npm.startsWith("Error")) {
        parts.push(`\n=== Global npm Packages ===\n${npm}`);
        totalPackages += npm.split("\n").length - 1;
      }

      // pip packages
      const pip = await sh("pip list 2>/dev/null | head -30");
      if (pip && !pip.startsWith("Error")) {
        parts.push(`\n=== Python Packages (pip) ===\n${pip}`);
        totalPackages += pip.split("\n").length - 2;
      }

      // cargo packages
      const cargo = await sh("cargo install --list 2>/dev/null | head -30");
      if (cargo && !cargo.startsWith("Error")) {
        parts.push(`\n=== Cargo Installed Tools ===\n${cargo}`);
      }

      const date = new Date().toISOString().split("T")[0];
      const sbomContent = parts.join("\n");

      // Save SBOM
      const filename = `sbom-${date}.txt`;
      const filePath = join(SBOM_DIR, filename);
      await writeFile(filePath, sbomContent, "utf-8");

      return {
        success: true,
        data: `SBOM generated: ${totalPackages} total packages across detected package managers.\nSaved to: ${filePath}\n\n${sbomContent}`,
      };
    },
  });
}

/**
 * Check installed packages against known CVEs.
 */
export function createSbomCveCheckTool() {
  return tool({
    description: "Check installed packages for known Common Vulnerabilities and Exposures (CVEs). Uses locally available vulnerability databases when possible.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      // Check for known vulnerable packages on Debian-based
      const debsecan = await sh("debsecan 2>/dev/null | head -30 || echo '(debsecan not installed — install with: apt install debsecan)')");
      parts.push(`=== Known Vulnerabilities (debsecan) ===\n${debsecan}`);

      // Check for apt history of security updates
      const aptHistory = await sh("grep -i security /var/log/apt/history.log 2>/dev/null | tail -10 || echo '(not available)')");
      parts.push(`\n=== Security Update History ===\n${aptHistory}`);

      return { success: true, data: parts.join("\n") };
    },
  });
}

registerTool("sbom_generate", "defense");
registerTool("sbom_cve_check", "defense");
