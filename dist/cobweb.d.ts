export interface Dependency {
    source: string;
    specifiers: string[];
    resolvedPath: string | null;
}
export interface DependencyGraph {
    [filePath: string]: Dependency[];
}
/**
 * Parse a single TypeScript file and extract its import dependencies.
 */
export declare function crawlDependencies(filePath: string, content: string): Dependency[];
/**
 * Crawl a directory and build a full dependency graph.
 */
export declare function crawlDirectory(dirPath: string): Promise<DependencyGraph>;
/**
 * Pretty-print the dependency graph.
 */
export declare function formatGraph(graph: DependencyGraph): string;
/**
 * Compute reverse dependencies — files that import the given target.
 */
export declare function computeReverseDeps(graph: DependencyGraph, targetPath: string): string[];
//# sourceMappingURL=cobweb.d.ts.map