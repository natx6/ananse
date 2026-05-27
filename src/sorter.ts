import { readdir, rename, mkdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import picocolors from "picocolors";

// ---------------------------------------------------------------------------
// File type categories
// ---------------------------------------------------------------------------

interface Category {
  name: string;
  emoji: string;
  patterns: RegExp[];
}

export const CATEGORIES: Category[] = [
  { name: "Images", emoji: "🖼", patterns: [/\.(jpg|jpeg|png|gif|bmp|svg|webp|ico|avif)$/i] },
  { name: "Videos", emoji: "🎬", patterns: [/\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)$/i] },
  { name: "Audio", emoji: "🎵", patterns: [/\.(mp3|wav|flac|ogg|aac|m4a|wma)$/i] },
  { name: "Documents", emoji: "📄", patterns: [/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp)$/i] },
  { name: "Text", emoji: "📝", patterns: [/\.(txt|md|csv|log|rtf)$/i] },
  { name: "Archives", emoji: "📦", patterns: [/\.(zip|tar|gz|rar|7z|bz2|xz|zst)$/i] },
  { name: "Code", emoji: "💻", patterns: [/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|css|html|json|yaml|yml|toml|xml|vue|svelte)$/i] },
  { name: "Scripts", emoji: "⚡", patterns: [/\.(sh|bash|zsh|fish|bat|ps1)$/i] },
  { name: "Data", emoji: "🗄", patterns: [/\.(sql|db|sqlite|db3|sqlite3|parquet)$/i] },
  { name: "Executables", emoji: "⚙", patterns: [/\.(exe|msi|deb|rpm|AppImage|dmg|apk|flatpak)$/i] },
  { name: "Fonts", emoji: "🔤", patterns: [/\.(ttf|otf|woff|woff2|eot)$/i] },
  { name: "ISOs", emoji: "💿", patterns: [/\.(iso|img)$/i] },
  { name: "Torrents", emoji: "🧲", patterns: [/\.(torrent|magnet)$/i] },
  { name: "3D", emoji: "🧊", patterns: [/\.(stl|obj|fbx|blend|3ds|step)$/i] },
  { name: "Certificates", emoji: "🔐", patterns: [/\.(pem|crt|key|p12|pfx|csr)$/i] },
  { name: "Config", emoji: "⚙", patterns: [/\.(env|ini|cfg|conf|editorconfig)$/i] },
  { name: "Other", emoji: "📁", patterns: [/.*/] },
];

export function categorize(file: string): Category {
  for (const cat of CATEGORIES) {
    if (cat.patterns.some((p) => p.test(file))) return cat;
  }
  return CATEGORIES[CATEGORIES.length - 1]; // Other
}

// ---------------------------------------------------------------------------
// clusterByName — group files sharing a common name prefix
// ---------------------------------------------------------------------------

export interface Cluster {
  name: string;
  files: string[];
}

/**
 * Group files by their first filename token (split on spaces, dashes, underscores).
 * Files sharing the same first token form a cluster for subfolder creation.
 */
export function clusterByName(files: string[]): Cluster[] {
  const groups = new Map<string, string[]>();
  const nameMap = new Map<string, string>(); // lowercased key → original first token

  for (const file of files) {
    const stem = basename(file, extname(file));
    const tokens = stem.split(/[-_\s]+/).filter(Boolean);
    const key = tokens[0]?.toLowerCase() ?? file;

    const arr = groups.get(key) ?? [];
    arr.push(file);
    groups.set(key, arr);

    // Preserve the original first token for folder naming
    if (tokens[0] && !nameMap.has(key)) {
      nameMap.set(key, tokens[0]);
    }
  }

  return Array.from(groups.entries()).map(([key, groupFiles]) => ({
    name: nameMap.get(key) ?? key,
    files: groupFiles,
  }));
}

// ---------------------------------------------------------------------------
// sortDirectory
// ---------------------------------------------------------------------------

export async function sortDirectory(dirPath: string): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  if (files.length === 0) {
    console.log(picocolors.yellow(`\n  No files found in ${picocolors.dim(dirPath)}\n`));
    return;
  }

  // Skip files that are already in a category subfolder
  const skipDirs = new Set(CATEGORIES.map((c) => c.name));
  const toSort = files.filter((f) => !skipDirs.has(f));

  if (toSort.length === 0) {
    console.log(picocolors.yellow(`\n  Everything already sorted.\n`));
    return;
  }

  // Step 1: Group files by category
  const categorized = new Map<string, string[]>();
  for (const file of toSort) {
    const cat = categorize(file);
    const arr = categorized.get(cat.name) ?? [];
    arr.push(file);
    categorized.set(cat.name, arr);
  }

  const results: { display: string; category: string; action: "moved" | "exists" }[] = [];
  const errors: string[] = [];

  // Step 2: For each category, cluster by name and move files
  for (const [catName, catFiles] of categorized) {
    const catDir = join(dirPath, catName);
    await mkdir(catDir, { recursive: true });

    const clusters = clusterByName(catFiles);

    for (const cluster of clusters) {
      const useSubfolder = cluster.files.length >= 2;
      const destDir = useSubfolder ? join(catDir, cluster.name) : catDir;

      if (useSubfolder) {
        await mkdir(destDir, { recursive: true });
      }

      for (const file of cluster.files) {
        const srcPath = join(dirPath, file);
        const destPath = join(destDir, file);
        const display = useSubfolder ? `${cluster.name}/${file}` : file;

        try {
          await rename(srcPath, destPath);
          results.push({ display, category: catName, action: "moved" });
        } catch (err: unknown) {
          if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOTEMPTY") {
            results.push({ display, category: catName, action: "exists" });
          } else {
            errors.push(file);
          }
        }
      }
    }
  }

  // Report
  const byCategory = new Map<string, typeof results>();
  for (const r of results) {
    const arr = byCategory.get(r.category) ?? [];
    arr.push(r);
    byCategory.set(r.category, arr);
  }

  console.log("");
  for (const [category, items] of byCategory) {
    const moved = items.filter((i) => i.action === "moved").length;
    const skipped = items.filter((i) => i.action === "exists").length;
    const cat = CATEGORIES.find((c) => c.name === category);
    const emoji = cat?.emoji ?? "📁";
    console.log(`  ${emoji}  ${picocolors.white(category)}  ${picocolors.dim(`(${moved} moved${skipped ? `, ${skipped} skipped` : ""})`)}`);
    for (let i = 0; i < items.length && i < 8; i++) {
      const isLast = i === Math.min(items.length, 8) - 1;
      console.log(`       ${isLast ? "└" : "├"} ${items[i].display}`);
    }
    if (items.length > 8) {
      console.log(`       ${picocolors.dim(`└ and ${items.length - 8} more`)}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n  ${picocolors.red(`Errors: ${errors.length} file(s) could not be moved`)}`);
  }

  console.log(`\n  ${picocolors.dim(`Sorted ${results.length} file(s) into ${byCategory.size} categories`)}\n`);
}
