/**
 * Central registry for all tool factories.
 * Each module self-registers its tools with the mode system via registerTool(),
 * and exports its factory functions. This barrel collects all factories and
 * provides a single `createAllTools()` call for the agent loop.
 */

// Core tools
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createCommandTool,
  createSearchTool,
  createCrawlTool,
  createBlastTool,
} from "./tools.js";
import { createBatchEditTool } from "./patch.js";
import { createSubAgentTool } from "./subagent.js";
import { createRememberTool } from "./remember.js";
import { createSubmitPlanTool } from "./planner.js";

// Scanner tools — shared by offense and defense
import { createScanSecretsTool, createScanOwaspTool } from "./scanner/codebase.js";
import { createScanPortsTool, createScanDnsTool } from "./scanner/network.js";

// Offense tools
import { createReconProcessesTool, createReconNetworkTool, createReconUsersTool, createReconSchedulerTool, createReconSuidTool } from "./offense/recon.js";
import { createPrivescSudoTool, createPrivescWritableTool, createPrivescKernelTool } from "./offense/privesc.js";
import { createPersistSshKeysTool, createPersistStartupTool, createPersistSshConfigTool } from "./offense/persistence.js";
import { createExploitPackageVulnsTool, createExploitServiceScanTool } from "./offense/exploit.js";
import { createReportTool } from "./offense/report.js";

// C2 tools
import { createC2FleetTool, createC2TaskCreateTool, createC2TaskListTool, createC2TaskDetailTool, createC2TaskCancelTool, createC2KillTool } from "./c2/tools.js";

// Defense tools
import { createMonitorFimSnapshotTool, createMonitorFimCheckTool, createMonitorRootkitTool, createMonitorProcessesTool } from "./defense/monitor.js";
import { createComplianceSshTool, createCompliancePasswordTool, createComplianceMountTool, createComplianceAuditdTool } from "./defense/compliance.js";
import { createSbomGenerateTool, createSbomCveCheckTool } from "./defense/sbom.js";

import type { AnanseConfig } from "./utils.js";

type ToolFactory = () => ReturnType<typeof createReadTool>;

interface ToolEntry {
  name: string;
  factory: ToolFactory | ((config: AnanseConfig) => unknown);
  needsConfig?: boolean;
}

const toolEntries: ToolEntry[] = [
  // Core
  { name: "read", factory: createReadTool as ToolFactory },
  { name: "write", factory: createWriteTool as ToolFactory },
  { name: "edit", factory: createEditTool as ToolFactory },
  { name: "command", factory: createCommandTool as ToolFactory },
  { name: "search", factory: createSearchTool as ToolFactory },
  { name: "crawl", factory: createCrawlTool as ToolFactory },
  { name: "patch", factory: createBatchEditTool as ToolFactory },
  { name: "blast", factory: createBlastTool as ToolFactory },
  { name: "subagent", factory: createSubAgentTool, needsConfig: true },
  { name: "submit_plan", factory: createSubmitPlanTool as ToolFactory },
  { name: "remember", factory: createRememberTool as ToolFactory },

  // Scanners
  { name: "scan_secrets", factory: createScanSecretsTool as ToolFactory },
  { name: "scan_owasp", factory: createScanOwaspTool as ToolFactory },
  { name: "scan_ports", factory: createScanPortsTool as ToolFactory },
  { name: "scan_dns", factory: createScanDnsTool as ToolFactory },

  // Offense
  { name: "recon_processes", factory: createReconProcessesTool as ToolFactory },
  { name: "recon_network", factory: createReconNetworkTool as ToolFactory },
  { name: "recon_users", factory: createReconUsersTool as ToolFactory },
  { name: "recon_scheduler", factory: createReconSchedulerTool as ToolFactory },
  { name: "recon_suid", factory: createReconSuidTool as ToolFactory },
  { name: "privesc_sudo", factory: createPrivescSudoTool as ToolFactory },
  { name: "privesc_writable", factory: createPrivescWritableTool as ToolFactory },
  { name: "privesc_kernel", factory: createPrivescKernelTool as ToolFactory },
  { name: "persist_ssh_keys", factory: createPersistSshKeysTool as ToolFactory },
  { name: "persist_startup", factory: createPersistStartupTool as ToolFactory },
  { name: "persist_ssh_config", factory: createPersistSshConfigTool as ToolFactory },
  { name: "exploit_package_vulns", factory: createExploitPackageVulnsTool as ToolFactory },
  { name: "exploit_service_scan", factory: createExploitServiceScanTool as ToolFactory },
  { name: "report", factory: createReportTool as ToolFactory },

  // C2 (offense)
  { name: "c2_fleet", factory: createC2FleetTool as ToolFactory },
  { name: "c2_task_create", factory: createC2TaskCreateTool as ToolFactory },
  { name: "c2_task_list", factory: createC2TaskListTool as ToolFactory },
  { name: "c2_task_detail", factory: createC2TaskDetailTool as ToolFactory },
  { name: "c2_task_cancel", factory: createC2TaskCancelTool as ToolFactory },
  { name: "c2_kill", factory: createC2KillTool as ToolFactory },

  // Defense
  { name: "monitor_fim_snapshot", factory: createMonitorFimSnapshotTool as ToolFactory },
  { name: "monitor_fim_check", factory: createMonitorFimCheckTool as ToolFactory },
  { name: "monitor_rootkit", factory: createMonitorRootkitTool as ToolFactory },
  { name: "monitor_processes", factory: createMonitorProcessesTool as ToolFactory },
  { name: "compliance_ssh", factory: createComplianceSshTool as ToolFactory },
  { name: "compliance_password", factory: createCompliancePasswordTool as ToolFactory },
  { name: "compliance_mount", factory: createComplianceMountTool as ToolFactory },
  { name: "compliance_auditd", factory: createComplianceAuditdTool as ToolFactory },
  { name: "sbom_generate", factory: createSbomGenerateTool as ToolFactory },
  { name: "sbom_cve_check", factory: createSbomCveCheckTool as ToolFactory },
];

export function createAllTools(config: AnanseConfig): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  for (const entry of toolEntries) {
    try {
      tools[entry.name] = entry.needsConfig
        ? (entry.factory as (config: AnanseConfig) => unknown)(config)
        : (entry.factory as ToolFactory)();
    } catch {
      // Skip tools that fail to create
      continue;
    }
  }
  return tools;
}
