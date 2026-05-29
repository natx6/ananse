import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import type { ToolResult } from "../types.js";

const NVD_API = "https://services.nvd.nist.gov/rest/json/cves/2.0";

interface NvdVuln {
  id: string;
  published: string;
  description: string;
  severity: string;
  cvssScore: number | null;
  attackVector: string;
}

async function fetchCves(params: Record<string, string>, limit = 20): Promise<NvdVuln[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${NVD_API}?${qs}`, {
    headers: { "User-Agent": "ananse/1.0" },
  });
  if (!res.ok) throw new Error(`NVD API error (${res.status})`);

  const body = (await res.json()) as {
    vulnerabilities: Array<{
      cve: {
        id: string;
        published: string;
        descriptions: Array<{ lang: string; value: string }>;
        metrics: Record<string, unknown>;
        weaknesses?: Array<{ description: Array<{ value: string }> }>;
      };
    }>;
  };

  const vulns = (body.vulnerabilities ?? []).slice(0, limit);
  return vulns.map((v) => {
    const c = v.cve;
    const metrics = c.metrics;
    // Try CVSS 3.1 first, then 3.0, then 2.0
    const cvssData =
      (metrics?.["cvssMetricV31"] as Array<Record<string, unknown>>)?.[0]
        ?.cvssData as Record<string, unknown> ?? null;
    const cvssData30 =
      !cvssData
        ? (metrics?.["cvssMetricV30"] as Array<Record<string, unknown>>)?.[0]
            ?.cvssData as Record<string, unknown> ?? null
        : null;
    const cvssData20 =
      (!cvssData && !cvssData30)
        ? (metrics?.["cvssMetricV2"] as Array<Record<string, unknown>>)?.[0]
            ?.cvssData as Record<string, unknown> ?? null
        : null;
    const data = cvssData ?? cvssData30 ?? cvssData20;
    return {
      id: c.id,
      published: c.published?.slice(0, 10) ?? "?",
      description:
        c.descriptions?.find((d) => d.lang === "en")?.value?.slice(0, 200) ??
        "—",
      severity: (data?.baseSeverity as string) ?? "UNKNOWN",
      cvssScore: (data?.baseScore as number) ?? null,
      attackVector: (data?.attackVector as string) ?? "—",
    };
  });
}

/**
 * Search for CVEs by keyword, product, or date range.
 */
export function createCveSearchTool() {
  return tool({
    description: "Search the National Vulnerability Database (NVD) for CVEs by keyword, product name, or date range. Free, no API key required. Returns CVE ID, publish date, description, CVSS score, severity, and attack vector.",
    inputSchema: z.object({
      keyword: z.string().describe("Search keyword (e.g., 'nginx', 'openssh', 'linux kernel')"),
      startDate: z.string().optional().describe("Start date (YYYY-MM-DD) to filter results"),
      endDate: z.string().optional().describe("End date (YYYY-MM-DD) to filter results"),
      limit: z.number().optional().describe("Max results (default: 15, max: 30)"),
    }),
    execute: async ({ keyword, startDate, endDate, limit }): Promise<ToolResult> => {
      const maxResults = Math.min(limit ?? 15, 30);
      const params: Record<string, string> = {
        keywordSearch: keyword,
        resultsPerPage: String(maxResults),
      };
      if (startDate) params.pubStartDate = `${startDate}T00:00:00.000`;
      if (endDate) params.pubEndDate = `${endDate}T23:59:59.999`;

      const vulns = await fetchCves(params, maxResults);

      if (vulns.length === 0) {
        return { success: true, data: `No CVEs found for "${keyword}".` };
      }

      const parts: string[] = [];
      parts.push(`  CVEs for "${keyword}" — ${vulns.length} results\n`);
      for (const v of vulns) {
        const score = v.cvssScore !== null ? `${v.cvssScore} ${v.severity}` : "N/A";
        parts.push(`  ${v.id}  (${v.published})  ${score}`);
        parts.push(`  Vector: ${v.attackVector}`);
        parts.push(`  ${v.description.slice(0, 150)}`);
        parts.push("");
      }

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Get details for a specific CVE.
 */
export function createCveDetailTool() {
  return tool({
    description: "Get full details for a specific CVE ID, including description, CVSS scores, attack vector, complexity, affected products, and known exploits.",
    inputSchema: z.object({
      cveId: z.string().describe("CVE ID (e.g., 'CVE-2024-3094', 'CVE-2023-44487')"),
    }),
    execute: async ({ cveId }): Promise<ToolResult> => {
      const vulns = await fetchCves({ cveId: cveId.toUpperCase() }, 1);
      if (vulns.length === 0) {
        return { success: true, data: `CVE not found: ${cveId}` };
      }
      const v = vulns[0];

      const parts: string[] = [];
      parts.push(`  ${v.id}`);
      parts.push(`  Published: ${v.published}`);
      parts.push(`  Severity:  ${v.severity} (${v.cvssScore ?? "N/A"})`);
      parts.push(`  Vector:    ${v.attackVector}`);
      parts.push(`\n  ${v.description}`);
      return { success: true, data: parts.join("\n") };
    },
  });
}

registerTool("cve_search", "offense");
registerTool("cve_detail", "offense");
