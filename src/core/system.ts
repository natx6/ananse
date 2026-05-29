import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import type { ToolResult } from "../types.js";

/**
 * Gather OS, kernel, hostname, uptime, CPU, and memory info.
 */
export function createSystemInfoTool() {
  return tool({
    description: "Gather detailed system information: OS/kernel version, hostname, uptime, CPU cores/load, total/available memory. Used for initial system profiling and situational awareness.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      const uname = await sh("uname -a 2>/dev/null");
      if (uname) parts.push(`  Kernel: ${uname.trim()}`);

      const hostname = await sh("hostname 2>/dev/null || cat /etc/hostname 2>/dev/null");
      if (hostname) parts.push(`  Host:   ${hostname.trim()}`);

      const uptime = await sh("uptime -p 2>/dev/null || uptime 2>/dev/null");
      if (uptime) parts.push(`  Uptime: ${uptime.trim()}`);

      const cpu = await sh(`nproc 2>/dev/null; grep -c ^processor /proc/cpuinfo 2>/dev/null`);
      if (cpu) {
        const cores = cpu.trim().split("\n").filter(Boolean)[0];
        parts.push(`  CPU:    ${cores || "?"} cores`);
      }

      const mem = await sh("free -h 2>/dev/null | grep Mem | awk '{print $2 \" total, \" $3 \" used, \" $4 \" avail\"}'");
      if (mem) parts.push(`  Memory: ${mem.trim()}`);

      const distro = await sh("cat /etc/os-release 2>/dev/null | grep -E '^PRETTY_NAME=' | cut -d= -f2 | tr -d '\"'");
      if (distro) parts.push(`  Distro: ${distro.trim()}`);

      return { success: true, data: parts.length > 0 ? parts.join("\n") : "System info unavailable (limited permissions)" };
    },
  });
}

/**
 * Show disk usage by mount point.
 */
export function createDiskUsageTool() {
  return tool({
    description: "Show disk usage by mount point, including total, used, and available space per filesystem. Useful for identifying full disks or unusual mounts.",
    inputSchema: z.object({
      human: z.boolean().optional().describe("Human-readable sizes (default: true)"),
    }),
    execute: async ({ human }): Promise<ToolResult> => {
      const flag = human !== false ? "-h" : "";
      const output = await sh(`df ${flag} -T 2>/dev/null | head -40`);
      if (!output || output.startsWith("Error")) {
        return { success: true, data: "Disk usage info unavailable (requires read access)" };
      }
      return { success: true, data: output };
    },
  });
}

/**
 * Show network interfaces, IPs, and routing table.
 */
export function createNetworkInfoTool() {
  return tool({
    description: "Display network interfaces, assigned IP addresses, default gateway, and DNS resolvers. Used for network situational awareness.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      const interfaces = await sh("ip -br addr 2>/dev/null || ifconfig 2>/dev/null");
      if (interfaces) {
        parts.push("=== Interfaces ===");
        parts.push(interfaces);
      }

      const route = await sh("ip route show default 2>/dev/null || route -n 2>/dev/null | head -10");
      if (route) {
        parts.push("\n=== Routing ===");
        parts.push(route);
      }

      const dns = await sh("cat /etc/resolv.conf 2>/dev/null | grep -v '^#' | grep -v '^$'");
      if (dns) {
        parts.push("\n=== DNS ===");
        parts.push(dns);
      }

      return {
        success: true,
        data: parts.length > 0 ? parts.join("\n") : "Network info unavailable (limited permissions)",
      };
    },
  });
}

registerTool("system_info", "core");
registerTool("disk_usage", "core");
registerTool("network_info", "core");
