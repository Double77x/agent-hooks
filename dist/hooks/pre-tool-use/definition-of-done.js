// src/hooks/pre-tool-use/definition-of-done.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

// src/adapters/claude.ts
function translateClaude(raw) {
  const data = raw;
  return {
    toolName: data.tool_name || data.toolName,
    toolInput: data.tool_input || data.toolInput,
    // Carry over other fields
    ...data
  };
}

// src/adapters/codex.ts
function translateCodex(raw) {
  const data = raw;
  let toolInput = data.arguments || data.args || {};
  if (typeof toolInput === "string") {
    try {
      toolInput = JSON.parse(toolInput);
    } catch {
    }
  }
  return {
    toolName: data.name || data.toolName,
    toolInput,
    ...data
  };
}

// src/adapters/agy.ts
function translateAGY(raw) {
  const data = raw;
  return {
    toolName: data.tool || data.name,
    toolInput: data.input || data.args,
    ...data
  };
}

// src/utils/payload.ts
var getPayload = (raw) => {
  const type = (process.env.AI_AGENT_TYPE || "claude").toLowerCase().trim();
  switch (type) {
    case "codex":
      return translateCodex(raw);
    case "agy":
      return translateAGY(raw);
    case "claude":
    default:
      return translateClaude(raw);
  }
};

// src/utils/hook-wrapper.ts
var AGENT = (process.env.AI_AGENT_TYPE || "claude").toLowerCase().trim();
var buildDenyOutput = (decision, reason, extra, eventName) => {
  if (AGENT === "agy") {
    return JSON.stringify({ action: decision, message: reason ?? "Hook blocked this action" });
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: eventName,
      permissionDecision: decision,
      permissionDecisionReason: reason,
      ...extra
    }
  };
  return JSON.stringify(output);
};
var buildAllowOutput = (extra, eventName) => {
  if (AGENT === "agy") {
    return JSON.stringify({ action: "allow" });
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: eventName,
      permissionDecision: "allow",
      ...extra
    }
  };
  return JSON.stringify(output);
};
var runHook = async (handler2) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  try {
    const sanitized = input.replace(/^\uFEFF/, "");
    const raw = JSON.parse(sanitized || "{}");
    const payload = getPayload(raw);
    const result = await handler2(payload);
    const eventName = result?.eventName ?? "PreToolUse";
    if (result && result.decision && result.decision !== "allow") {
      process.stdout.write(buildDenyOutput(result.decision, result.reason, result.extraOutput, eventName));
      if (result.decision === "deny") {
        process.exitCode = 2;
      }
      return;
    } else if (result && result.extraOutput) {
      process.stdout.write(buildAllowOutput(result.extraOutput, eventName));
      return;
    }
    if (AGENT === "agy") {
      process.stdout.write(JSON.stringify({ action: "allow" }));
    } else {
      process.stdout.write(JSON.stringify({}));
    }
  } catch (err) {
    process.stderr.write(`[ai-hooks:wrapper] Error processing hook: ${err.message}
`);
    process.stdout.write(JSON.stringify({}));
  }
};

// src/hooks/pre-tool-use/definition-of-done.ts
var runCheck = (cmd) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
var handler = (payload) => {
  const toolName = payload.toolName || "";
  if (!/^(finish|done|complete_task|submit)$/i.test(toolName)) {
    return;
  }
  const failures = [];
  if (fs.existsSync("package.json")) {
    process.stderr.write(`[ai-hooks:dod] Running Node.js checks (oxlint)...
`);
    const hasOx = fs.existsSync(path.join("node_modules", ".bin", "oxlint"));
    const npxCmd = hasOx ? "npx --no" : "npx";
    if (!runCheck(`${npxCmd} oxlint .`)) failures.push("Stale Lint (oxlint)");
  }
  if (fs.existsSync("tsconfig.json")) {
    process.stderr.write(`[ai-hooks:dod] Running TypeScript checks...
`);
    if (!runCheck("npx --no tsc --noEmit")) failures.push("Type Errors (tsc)");
  }
  if (fs.existsSync("uv.lock") || fs.existsSync("pyproject.toml")) {
    process.stderr.write(`[ai-hooks:dod] Running Python checks (ruff, ty)...
`);
    if (!runCheck("ruff check .")) failures.push("Stale Lint (ruff)");
    if (!runCheck("ty check .")) failures.push("Type Errors (ty)");
  }
  if (fs.existsSync("tests") || fs.existsSync("test")) {
    process.stderr.write(`[ai-hooks:dod] Running Test suites...
`);
    const testCmd = fs.existsSync("package.json") ? "npm test" : "pytest";
    if (!runCheck(testCmd)) failures.push("Failing Tests");
  }
  if (failures.length > 0) {
    const decision = "deny";
    const reason = `\u{1F6AB} [Definition of Done] Cannot finish task. The following checks are failing:
- ${failures.join("\n- ")}

Please fix these issues before marking the task as complete.`;
    process.stderr.write(`[ai-hooks:dod] Denied finish. Failures: ${failures.join(", ")}
`);
    return { decision, reason };
  }
  process.stderr.write(`[ai-hooks:dod] All checks passed. Task complete.
`);
  return { decision: "allow" };
};
if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
export {
  handler
};
