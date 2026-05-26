import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { AgentPayload } from "@/types/index.js";
import { runHook } from "@/utils/hook-wrapper.js";

const ENABLE_AUTO_FIX = process.env.AI_ENABLE_AUTO_FIX !== "0";
const LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".ai-hooks", "logs");

export const logToFile = (entry: Record<string, unknown>): void => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: "auto-fix", ...entry }) + "\n");
  } catch {
    // Silently fail
  }
};

const runCommand = (cmd: string): boolean => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

export const runFixes = (target: string): { cmd: string; success: boolean }[] => {
  const fixes: string[] = [];

  // Node.js checks (oxlint, oxfmt)
  if (fs.existsSync("package.json")) {
    const hasOx = fs.existsSync(path.join("node_modules", ".bin", "oxlint"));
    const npxCmd = hasOx ? "npx --no" : "npx";
    fixes.push(`${npxCmd} oxlint --fix ${target}`);
    fixes.push(`${npxCmd} oxfmt ${target}`);
  }

  // Python checks (ruff)
  if (fs.existsSync("requirements.txt") || fs.existsSync("pyproject.toml") || fs.existsSync("uv.lock")) {
    fixes.push(`ruff check --fix ${target}`);
    fixes.push(`ruff format ${target}`);
  }

  return fixes.map((cmd) => {
    const success = runCommand(cmd);
    return { cmd, success };
  });
};

export const handler = (payload: AgentPayload) => {
  if (!ENABLE_AUTO_FIX) return;

  const toolName = payload.toolName || "";

  // We only care about tools that likely modify files
  const isFileMutationTool =
    /^(Write|Edit|replace|write_file|write_text_file|edit_file|multi_replace_file_content|replace_file_content)$/i.test(
      toolName,
    );
  const isShellTool = /^(Bash|run_command|shell|terminal|run_shell_command)$/i.test(toolName);

  if (!isFileMutationTool && !isShellTool) {
    return;
  }

  let target = ".";
  if (isFileMutationTool) {
    const toolInput = (payload.toolInput as Record<string, string>) || {};
    target = toolInput.TargetFile || toolInput.file_path || toolInput.path || ".";
    // Wrap target in quotes if it has spaces
    if (target.includes(" ")) {
      target = `"${target}"`;
    }
  }

  process.stderr.write(`[ai-hooks:auto-fix] running post-tool auto-fixes for ${toolName} on ${target}...\n`);
  const results = runFixes(target);

  if (results.length > 0) {
    logToFile({ results, toolName });
  }

  return { eventName: "PostToolUse" as const };
};

if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
