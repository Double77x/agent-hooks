// src/hooks/post-tool-use/auto-fix.ts
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

// src/hooks/post-tool-use/auto-fix.ts
var ENABLE_AUTO_FIX = process.env.AI_ENABLE_AUTO_FIX !== "0";
var LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".ai-hooks", "logs");
var logToFile = (entry) => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), hook: "auto-fix", ...entry }) + "\n");
  } catch {
  }
};
var runCommand = (cmd) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
var runFixes = (target) => {
  const fixes = [];
  if (fs.existsSync("package.json")) {
    const hasOx = fs.existsSync(path.join("node_modules", ".bin", "oxlint"));
    const npxCmd = hasOx ? "npx --no" : "npx";
    fixes.push(`${npxCmd} oxlint --fix ${target}`);
    fixes.push(`${npxCmd} oxfmt ${target}`);
  }
  if (fs.existsSync("requirements.txt") || fs.existsSync("pyproject.toml") || fs.existsSync("uv.lock")) {
    fixes.push(`ruff check --fix ${target}`);
    fixes.push(`ruff format ${target}`);
  }
  return fixes.map((cmd) => {
    const success = runCommand(cmd);
    return { cmd, success };
  });
};
var handler = (payload) => {
  if (!ENABLE_AUTO_FIX) return;
  const toolName = payload.toolName || "";
  const isFileMutationTool = /^(Write|Edit|replace|write_file|write_text_file|edit_file|multi_replace_file_content|replace_file_content)$/i.test(
    toolName
  );
  const isShellTool = /^(Bash|run_command|shell|terminal|run_shell_command)$/i.test(toolName);
  if (!isFileMutationTool && !isShellTool) {
    return;
  }
  let target = ".";
  if (isFileMutationTool) {
    const toolInput = payload.toolInput || {};
    target = toolInput.TargetFile || toolInput.file_path || toolInput.path || ".";
    if (target.includes(" ")) {
      target = `"${target}"`;
    }
  }
  process.stderr.write(`[ai-hooks:auto-fix] running post-tool auto-fixes for ${toolName} on ${target}...
`);
  const results = runFixes(target);
  if (results.length > 0) {
    logToFile({ results, toolName });
  }
  return { eventName: "PostToolUse" };
};
if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
export {
  handler,
  logToFile,
  runFixes
};
