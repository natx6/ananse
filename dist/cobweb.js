import { readFile, readdir } from "node:fs/promises";
import { accessSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import ts from "typescript";
/**
 * Parse a single TypeScript file and extract its import dependencies.
 */
export function crawlDependencies(filePath, content) {
    const deps = [];
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    function visit(node) {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const source = node.moduleSpecifier.text;
            const specifiers = [];
            if (node.importClause) {
                if (node.importClause.name) {
                    specifiers.push(`default: ${node.importClause.name.text}`);
                }
                if (node.importClause.namedBindings) {
                    if (ts.isNamedImports(node.importClause.namedBindings)) {
                        for (const el of node.importClause.namedBindings.elements) {
                            specifiers.push(el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text);
                        }
                    }
                    else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                        specifiers.push(`* as ${node.importClause.namedBindings.name.text}`);
                    }
                }
            }
            // Try to resolve relative paths
            let resolvedPath = null;
            if (source.startsWith(".")) {
                const baseDir = dirname(filePath);
                const candidates = [
                    resolve(baseDir, source),
                    resolve(baseDir, source + ".ts"),
                    resolve(baseDir, source + ".tsx"),
                    resolve(baseDir, source + ".js"),
                    resolve(baseDir, source, "index.ts"),
                    resolve(baseDir, source, "index.tsx"),
                    resolve(baseDir, source, "index.js"),
                ];
                resolvedPath = candidates.find((c) => {
                    try {
                        accessSync(c);
                        return true;
                    }
                    catch {
                        return false;
                    }
                }) ?? null;
            }
            deps.push({ source, specifiers, resolvedPath });
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return deps;
}
/**
 * Crawl a directory and build a full dependency graph.
 */
export async function crawlDirectory(dirPath) {
    const graph = {};
    const files = await collectFiles(dirPath);
    for (const file of files) {
        const content = await readFile(file, "utf-8");
        const deps = crawlDependencies(file, content);
        if (deps.length > 0) {
            graph[file] = deps;
        }
    }
    return graph;
}
/**
 * Pretty-print the dependency graph.
 */
export function formatGraph(graph) {
    const lines = [];
    for (const [file, deps] of Object.entries(graph)) {
        lines.push(file);
        for (let i = 0; i < deps.length; i++) {
            const dep = deps[i];
            const isLast = i === deps.length - 1;
            const prefix = isLast ? "└── " : "├── ";
            const resolved = dep.resolvedPath
                ? ` → ${relative(process.cwd(), dep.resolvedPath)}`
                : "";
            lines.push(`${prefix}${dep.source}${resolved}`);
            // Show specifiers as child branches
            for (let j = 0; j < dep.specifiers.length; j++) {
                const childIsLast = j === dep.specifiers.length - 1;
                const childPrefix = isLast ? "    " : "│   ";
                const childConn = childIsLast ? "└── " : "├── ";
                lines.push(`${childPrefix}${childConn}${dep.specifiers[j]}`);
            }
        }
        lines.push("");
    }
    return lines.join("\n");
}
/**
 * Compute reverse dependencies — files that import the given target.
 */
export function computeReverseDeps(graph, targetPath) {
    const result = [];
    for (const [file, deps] of Object.entries(graph)) {
        if (file === targetPath)
            continue;
        for (const dep of deps) {
            if (dep.resolvedPath === targetPath) {
                result.push(file);
                break;
            }
        }
    }
    return result;
}
/**
 * Recursively find all .ts/.tsx files in a directory.
 */
async function collectFiles(dirPath) {
    const files = [];
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = resolve(dirPath, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
            files.push(...(await collectFiles(fullPath)));
        }
        else if (entry.isFile() && /\.(ts|tsx)$/i.test(entry.name)) {
            if (!entry.name.endsWith(".d.ts")) {
                files.push(fullPath);
            }
        }
    }
    return files;
}
//# sourceMappingURL=cobweb.js.map