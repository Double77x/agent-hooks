// src/hooks/pre-tool-use/context-injection.ts
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

// src/hooks/pre-tool-use/context-injection.ts
var MAX_BYTES = 2e3;
var safeReadFile = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return "";
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
var handler = (payload) => {
  const toolName = payload.toolName || "";
  if (!/^(thought|plan|strategy|update_topic|explore)$/i.test(toolName)) {
    return;
  }
  let extraContext = "\n\n--- INJECTED PROJECT CONTEXT ---\n";
  if (fs.existsSync("README.md")) {
    extraContext += `
[README.md Summary]:
${safeReadFile("README.md")}
`;
  }
  const archPath = path.join("docs", "architecture.md");
  if (fs.existsSync(archPath)) {
    extraContext += `
[Architecture Docs]:
${safeReadFile(archPath)}
`;
  }
  try {
    const gitLog = execSync("git log -n 3 --oneline", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (gitLog) {
      extraContext += `
[Recent Commits]:
${gitLog.trim()}
`;
    }
  } catch {
  }
  process.stderr.write(`[ai-hooks:context-injection] Injected ${extraContext.length} bytes of context.
`);
  return {
    decision: "allow",
    extraOutput: { injectedContext: extraContext }
  };
};
if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
export {
  handler
};
