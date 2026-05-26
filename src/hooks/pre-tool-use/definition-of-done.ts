import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { AgentPayload, PermissionDecision } from "@/types/index.js";
import { runHook } from "@/utils/hook-wrapper.js";

const runCheck = (cmd: string): boolean => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

export const handler = (payload: AgentPayload) => {
  const toolName = payload.toolName || "";

  // Match finish/done tools
  if (!/^(finish|done|complete_task|submit)$/i.test(toolName)) {
    return;
  }

  const failures: string[] = [];

  // 1. Lint/Type Check Gate
  if (fs.existsSync("package.json")) {
    process.stderr.write(`[ai-hooks:dod] Running Node.js checks (oxlint)...\n`);
    const hasOx = fs.existsSync(path.join("node_modules", ".bin", "oxlint"));
    const npxCmd = hasOx ? "npx --no" : "npx";
    if (!runCheck(`${npxCmd} oxlint .`)) failures.push("Stale Lint (oxlint)");
  }

  if (fs.existsSync("tsconfig.json")) {
    process.stderr.write(`[ai-hooks:dod] Running TypeScript checks...\n`);
    if (!runCheck("npx --no tsc --noEmit")) failures.push("Type Errors (tsc)");
  }

  if (fs.existsSync("uv.lock") || fs.existsSync("pyproject.toml")) {
    process.stderr.write(`[ai-hooks:dod] Running Python checks (ruff, ty)...\n`);
    if (!runCheck("ruff check .")) failures.push("Stale Lint (ruff)");
    if (!runCheck("ty check .")) failures.push("Type Errors (ty)");
  }

  // 2. Test Gate
  if (fs.existsSync("tests") || fs.existsSync("test")) {
    process.stderr.write(`[ai-hooks:dod] Running Test suites...\n`);
    const testCmd = fs.existsSync("package.json") ? "npm test" : "pytest";
    if (!runCheck(testCmd)) failures.push("Failing Tests");
  }

  if (failures.length > 0) {
    const decision: PermissionDecision = "deny";
    const reason = `🚫 [Definition of Done] Cannot finish task. The following checks are failing:\n- ${failures.join("\n- ")}\n\nPlease fix these issues before marking the task as complete.`;

    process.stderr.write(`[ai-hooks:dod] Denied finish. Failures: ${failures.join(", ")}\n`);
    return { decision, reason };
  }

  process.stderr.write(`[ai-hooks:dod] All checks passed. Task complete.\n`);
  return { decision: "allow" as PermissionDecision };
};

if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
