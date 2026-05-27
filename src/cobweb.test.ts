import { describe, it, expect } from "vitest";
import { crawlDependencies, computeReverseDeps } from "./cobweb.js";
import { categorize, clusterByName } from "./sorter.js";
import { createSession, addMessage } from "./session.js";
import { condenseError } from "./diagnose.js";
import type { DependencyGraph } from "./cobweb.js";

// ---------------------------------------------------------------------------
// cobweb — dependency parsing
// ---------------------------------------------------------------------------

describe("cobweb", () => {
  it("extracts import dependencies from source", () => {
    const code = `
      import { readFile } from "node:fs/promises";
      import { resolve } from "node:path";
      import { crawlDependencies } from "./cobweb.js";
    `;
    const deps = crawlDependencies("/test/file.ts", code);
    expect(deps).toHaveLength(3);
    expect(deps[0].source).toBe("node:fs/promises");
    expect(deps[1].source).toBe("node:path");
    expect(deps[2].source).toBe("./cobweb.js");
    expect(deps[2].resolvedPath).toBeNull();
  });

  it("handles files with no imports", () => {
    const deps = crawlDependencies("/test/empty.ts", "const x = 1;\n");
    expect(deps).toHaveLength(0);
  });

  it("extracts default imports", () => {
    const code = `import express from "express";\n`;
    const deps = crawlDependencies("/test/app.ts", code);
    expect(deps).toHaveLength(1);
    expect(deps[0].specifiers).toContain("default: express");
  });

  it("extracts namespace imports", () => {
    const code = `import * as fs from "node:fs";\n`;
    const deps = crawlDependencies("/test/app.ts", code);
    expect(deps).toHaveLength(1);
    expect(deps[0].specifiers).toContain("* as fs");
  });

  it("extracts named imports with aliases", () => {
    const code = `import { readFile as read } from "node:fs";\n`;
    const deps = crawlDependencies("/test/app.ts", code);
    expect(deps).toHaveLength(1);
    expect(deps[0].specifiers).toContain("readFile as read");
  });

  it("computes reverse dependencies", () => {
    const graph: DependencyGraph = {
      "/src/a.ts": [{ source: "./b", specifiers: [], resolvedPath: "/src/b.ts" }],
      "/src/b.ts": [{ source: "lodash", specifiers: [], resolvedPath: null }],
      "/src/c.ts": [{ source: "./b", specifiers: [], resolvedPath: "/src/b.ts" }],
    };
    const rev = computeReverseDeps(graph, "/src/b.ts");
    expect(rev).toHaveLength(2);
    expect(rev).toContain("/src/a.ts");
    expect(rev).toContain("/src/c.ts");
  });

  it("returns empty for files with no reverse deps", () => {
    const graph: DependencyGraph = {
      "/src/a.ts": [{ source: "lodash", specifiers: [], resolvedPath: null }],
    };
    expect(computeReverseDeps(graph, "/src/a.ts")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sorter — file categorization and clustering
// ---------------------------------------------------------------------------

describe("sorter", () => {
  describe("categorize", () => {
    it("categorizes images by extension", () => {
      expect(categorize("photo.jpg").name).toBe("Images");
      expect(categorize("logo.png").name).toBe("Images");
      expect(categorize("icon.svg").name).toBe("Images");
    });

    it("categorizes code files", () => {
      expect(categorize("index.ts").name).toBe("Code");
      expect(categorize("app.js").name).toBe("Code");
      expect(categorize("main.py").name).toBe("Code");
    });

    it("categorizes documents", () => {
      expect(categorize("report.pdf").name).toBe("Documents");
      expect(categorize("spreadsheet.xlsx").name).toBe("Documents");
    });

    it("falls back to Other for unknown extensions", () => {
      expect(categorize("unknown.xyz123").name).toBe("Other");
    });

    it("handles files without extensions", () => {
      expect(categorize("Makefile").name).toBe("Other");
    });
  });

  describe("clusterByName", () => {
    it("groups files sharing the same first token", () => {
      const clusters = clusterByName([
        "Screenshot 2024-01-01.png",
        "Screenshot 2024-01-02.png",
        "photo.jpg",
      ]);
      expect(clusters).toHaveLength(2);
      const screenshot = clusters.find((c) => c.name === "Screenshot");
      expect(screenshot?.files).toHaveLength(2);
      const photo = clusters.find((c) => c.name === "photo");
      expect(photo?.files).toHaveLength(1);
    });

    it("creates singleton clusters for unique files", () => {
      const clusters = clusterByName(["a.txt", "b.txt", "c.txt"]);
      expect(clusters).toHaveLength(3);
      clusters.forEach((c) => expect(c.files).toHaveLength(1));
    });

    it("groups by first token for complex names", () => {
      const clusters = clusterByName([
        "IMG_0001.jpg",
        "IMG_0002.jpg",
        "IMG_0003.jpg",
      ]);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].name).toBe("IMG");
      expect(clusters[0].files).toHaveLength(3);
    });

    it("handles empty input", () => {
      expect(clusterByName([])).toHaveLength(0);
    });

    it("groups case-insensitively", () => {
      const clusters = clusterByName([
        "screenshot 1.png",
        "Screenshot 2.png",
        "SCREENSHOT 3.png",
      ]);
      const ss = clusters.find((c) => c.name.toLowerCase() === "screenshot");
      expect(ss?.files).toHaveLength(3);
    });

    it("uses first token as folder name preserving case", () => {
      const clusters = clusterByName(["MyFile_v1.txt", "MyFile_v2.txt"]);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].name).toBe("MyFile");
    });

    it("handles files with dots — dots don't act as token separators", () => {
      const clusters = clusterByName([
        "app.config.dev.json",
        "app.config.prod.json",
      ]);
      // stem of "app.config.dev.json" = "app.config.dev"
      // stem of "app.config.prod.json" = "app.config.prod"
      // These have different stems so they DON'T cluster together
      expect(clusters.length).toBeGreaterThanOrEqual(2);
      // Each file forms its own singleton cluster
      for (const c of clusters) {
        expect(c.files).toHaveLength(1);
      }
    });

    it("handles files with dashes in name", () => {
      const clusters = clusterByName([
        "my-component.tsx",
        "my-component.test.tsx",
        "my-component.stories.tsx",
      ]);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].files).toHaveLength(3);
    });

    it("creates separate clusters for distinct first tokens", () => {
      const clusters = clusterByName([
        "foo.txt",
        "bar.txt",
        "foo_2.txt",
      ]);
      expect(clusters).toHaveLength(2);
      const foo = clusters.find((c) => c.name === "foo");
      expect(foo?.files).toHaveLength(2);
      const bar = clusters.find((c) => c.name === "bar");
      expect(bar?.files).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// session — creation and message management
// ---------------------------------------------------------------------------

describe("session", () => {
  it("creates a session with the expected structure", () => {
    const config = { apiKey: "test" };
    const session = createSession(config, null, 10);
    expect(session.id).toBeTruthy();
    expect(session.messages).toHaveLength(0);
    expect(session.fileCount).toBe(10);
    expect(session.config.apiKey).toBe("test");
    expect(session.personality).toBeNull();
  });

  it("addMessage appends and updates updatedAt", () => {
    const config = { apiKey: "test" };
    const session = createSession(config, null, 0);

    const msg = {
      id: "1",
      role: "user" as const,
      content: "hello",
      timestamp: new Date().toISOString(),
    };

    // addMessage mutates and returns
    const returned = addMessage(session, msg);

    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("hello");
    expect(session.updatedAt).toBeTruthy();
    // Object is mutated in-place
    expect(returned).toBe(session);
  });

  it("addMessage appends multiple messages", () => {
    const session = createSession({}, null, 0);
    addMessage(session, { id: "1", role: "user" as const, content: "q1", timestamp: "" });
    addMessage(session, { id: "2", role: "assistant" as const, content: "a1", timestamp: "" });
    addMessage(session, { id: "3", role: "user" as const, content: "q2", timestamp: "" });
    expect(session.messages).toHaveLength(3);
    expect(session.messages[0].content).toBe("q1");
    expect(session.messages[1].content).toBe("a1");
    expect(session.messages[2].content).toBe("q2");
  });
});

// ---------------------------------------------------------------------------
// diagnose — error condensation
// ---------------------------------------------------------------------------

describe("diagnose", () => {
  it("strips ANSI escape codes", () => {
    const input = "[31merror[0m: something failed";
    const result = condenseError(input);
    expect(result).toBe("error: something failed");
  });

  it("strips carriage return noise in CRLF files", () => {
    // \r before \n is stripped, keeping the \n
    const input = "line1\r\nline2\r\nline3";
    const result = condenseError(input);
    expect(result).toBe("line1\nline2\nline3");
  });

  it("strips progress-overwrite content after \\r", () => {
    // Content after \r is stripped (spinner/progress output)
    const input = "prefix\rreplacement";
    const result = condenseError(input);
    expect(result).toBe("prefix");
  });

  it("replaces node_modules paths", () => {
    const input = "Error at /project/node_modules/foo/bar/index.js:1:2";
    const result = condenseError(input);
    expect(result).toContain("/node_modules/…");
    expect(result).not.toContain("/project/node_modules/foo/bar/index.js");
  });

  it("truncates long output", () => {
    const input = "x".repeat(5000);
    const result = condenseError(input);
    expect(result.length).toBeLessThan(3500);
    expect(result).toContain("truncated");
  });

  it("handles empty input", () => {
    expect(condenseError("")).toBe("");
  });
});
