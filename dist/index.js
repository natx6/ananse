#!/usr/bin/env node
import picocolors from "picocolors";
import { Command } from "commander";
import { spinner, text, isCancel } from "@clack/prompts";
import { LOGO } from "./branding.js";
import { checkConfig, checkPersonality, scanDirectory } from "./utils.js";
async function bootSequence() {
    console.clear();
    console.log(picocolors.white(LOGO));
    const s = spinner();
    s.start("Weaving local context...");
    s.message("Weaving local context... checking config");
    const config = await checkConfig();
    s.message("Weaving local context... reading project personality");
    await checkPersonality();
    s.message("Weaving local context... scanning project files");
    const fileCount = await scanDirectory();
    s.stop(picocolors.green("Context woven successfully"));
    console.log("");
    const summaryParts = [];
    summaryParts.push(`provider: ${config?.provider ?? picocolors.dim("not set")}`);
    summaryParts.push(`${fileCount} file${fileCount === 1 ? "" : "s"} in scope`);
    console.log(picocolors.dim(`  ${summaryParts.join(" | ")}`));
    console.log("");
    const response = await text({
        message: "How can I help you weave your code?",
        placeholder: "e.g., Build a REST API, refactor this module, debug an issue...",
    });
    if (isCancel(response)) {
        console.log(picocolors.yellow("\n  Goodbye!"));
        process.exit(0);
    }
    console.log(picocolors.green(`\n  You: ${response}`));
    console.log(picocolors.dim("  (AI agent coming soon)"));
    console.log("");
    console.log(picocolors.dim("  Thank you for using Ananse!"));
}
const program = new Command()
    .name("ananse")
    .description("AI agent for coding tasks")
    .version("0.1.0")
    .action(bootSequence);
await program.parseAsync(process.argv);
//# sourceMappingURL=index.js.map