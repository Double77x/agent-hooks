import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { AgentPayload, PermissionDecision } from "@/types/index.js";
import { runHook } from "@/utils/hook-wrapper.js";

const MAX_BYTES = 2000;

const safeReadFile = (filePath: string): string => {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return "";

    // Read up to MAX_BYTES to prevent memory bloat and context token exhaustion
    const buffer = Buffer.alloc(MAX_BYTES);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, MAX_BYTES, 0);
    fs.closeSync(fd);

    let content = buffer.toString("utf8", 0, bytesRead);
    if (stats.size > MAX_BYTES) {
      content += "\n...[truncated]";
    }
    return content;
  } catch {
    return "";
  }
};

/**
 * Injects project context (README, docs, git) into the agent's thought process.
 * Usually triggered before planning or exploration tools.
 */
export const handler = (payload: AgentPayload) => {
  const toolName = payload.toolName || "";

  // Trigger on planning/thought tools
  if (!/^(thought|plan|strategy|update_topic|explore)$/i.test(toolName)) {
    return;
  }

  let extraContext = "\n\n--- INJECTED PROJECT CONTEXT ---\n";

  // 1. README
  if (fs.existsSync("README.md")) {
    extraContext += `\n[README.md Summary]:\n${safeReadFile("README.md")}\n`;
  }

  // 2. Architecture Docs
  const archPath = path.join("docs", "architecture.md");
  if (fs.existsSync(archPath)) {
    extraContext += `\n[Architecture Docs]:\n${safeReadFile(archPath)}\n`;
  }

  // 3. Recent Git History
  try {
    const gitLog = execSync("git log -n 3 --oneline", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (gitLog) {
      extraContext += `\n[Recent Commits]:\n${gitLog.trim()}\n`;
    }
  } catch {
    // Git not available or not a repo
  }

  process.stderr.write(`[ai-hooks:context-injection] Injected ${extraContext.length} bytes of context.\n`);

  return {
    decision: "allow" as PermissionDecision,
    extraOutput: { injectedContext: extraContext },
  };
};

if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
