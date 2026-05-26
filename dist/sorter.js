import { readdir, rename, mkdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import picocolors from "picocolors";
const CATEGORIES = [
    { name: "Images", emoji: "🖼", patterns: [/\.(jpg|jpeg|png|gif|bmp|svg|webp|ico|avif)$/i] },
    { name: "Videos", emoji: "🎬", patterns: [/\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)$/i] },
    { name: "Audio", emoji: "🎵", patterns: [/\.(mp3|wav|flac|ogg|aac|m4a|wma)$/i] },
    { name: "Documents", emoji: "📄", patterns: [/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp)$/i] },
    { name: "Text", emoji: "📝", patterns: [/\.(txt|md|csv|log|rtf)$/i] },
    { name: "Archives", emoji: "📦", patterns: [/\.(zip|tar|gz|rar|7z|bz2|xz|zst)$/i] },
    { name: "Code", emoji: "💻", patterns: [/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|css|html|json|yaml|yml|toml|xml|vue|svelte)$/i] },
    { name: "Scripts", emoji: "⚡", patterns: [/\.(sh|bash|zsh|fish|bat|ps1)$/i] },
    { name: "Data", emoji: "🗄", patterns: [/\.(sql|db|sqlite|db3|sqlite3|csv|parquet)$/i] },
    { name: "Executables", emoji: "⚙", patterns: [/\.(exe|msi|deb|rpm|AppImage|dmg|apk|flatpak)$/i] },
    { name: "Fonts", emoji: "🔤", patterns: [/\.(ttf|otf|woff|woff2|eot)$/i] },
    { name: "ISOs", emoji: "💿", patterns: [/\.(iso|img)$/i] },
    { name: "Torrents", emoji: "🧲", patterns: [/\.(torrent|magnet)$/i] },
    { name: "3D", emoji: "🧊", patterns: [/\.(stl|obj|fbx|blend|3ds|step)$/i] },
    { name: "Certificates", emoji: "🔐", patterns: [/\.(pem|crt|key|p12|pfx|csr)$/i] },
    { name: "Config", emoji: "⚙", patterns: [/\.(env|ini|cfg|conf|editorconfig)$/i] },
    { name: "Other", emoji: "📁", patterns: [/.*/] },
];
function categorize(file) {
    for (const cat of CATEGORIES) {
        if (cat.patterns.some((p) => p.test(file)))
            return cat;
    }
    return CATEGORIES[CATEGORIES.length - 1]; // Other
}
// ---------------------------------------------------------------------------
// sortDirectory
// ---------------------------------------------------------------------------
export async function sortDirectory(dirPath) {
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
    const results = [];
    const errors = [];
    for (const file of toSort) {
        const cat = categorize(file);
        const destDir = join(dirPath, cat.name);
        const srcPath = join(dirPath, file);
        const destPath = join(destDir, file);
        try {
            await mkdir(destDir, { recursive: true });
            // Check if destination already exists
            try {
                await rename(srcPath, destPath);
                results.push({ file, category: cat.name, action: "moved" });
            }
            catch (err) {
                if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
                    results.push({ file, category: cat.name, action: "exists" });
                }
                else {
                    throw err;
                }
            }
        }
        catch {
            errors.push(file);
        }
    }
    // Report
    const byCategory = new Map();
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
        for (const item of items.slice(0, 5)) {
            console.log(`       ${item.action === "moved" ? picocolors.green("├") : picocolors.yellow("─")} ${item.file}`);
        }
        if (items.length > 5) {
            console.log(`       ${picocolors.dim(`└ and ${items.length - 5} more`)}`);
        }
    }
    if (errors.length > 0) {
        console.log(`\n  ${picocolors.red(`Errors: ${errors.length} file(s) could not be moved`)}`);
    }
    console.log(`\n  ${picocolors.dim(`Sorted ${results.length} file(s) into ${byCategory.size} categories`)}\n`);
}
//# sourceMappingURL=sorter.js.map