// src/hooks/pre-tool-use/pkg-manager-enforcement.ts
import * as path from "node:path";

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

// src/hooks/pre-tool-use/pkg-manager-enforcement.ts
var ALLOWED_NODE_MANAGER = process.env.AI_ALLOWED_NODE_MANAGER || "pnpm";
var ALLOWED_PYTHON_MANAGER = process.env.AI_ALLOWED_PYTHON_MANAGER || "uv";
var FORBIDDEN_NODE = ["pnpm", "npm", "yarn", "bun"].filter((m) => m !== ALLOWED_NODE_MANAGER);
var FORBIDDEN_PYTHON = ["pip", "pip3", "poetry", "conda", "mamba", "pipenv"].filter(
  (m) => m !== ALLOWED_PYTHON_MANAGER
);
var checkCommand = (command) => {
  const usedForbiddenNode = FORBIDDEN_NODE.find((m) => new RegExp(`\\b${m}\\b`).test(command));
  if (usedForbiddenNode) {
    return `\u{1F6AB} [node-enforcement] This project uses ${ALLOWED_NODE_MANAGER}. Please do not use ${usedForbiddenNode}.`;
  }
  const usedForbiddenPython = FORBIDDEN_PYTHON.find((m) => new RegExp(`\\b${m}\\b`).test(command));
  if (usedForbiddenPython) {
    return `\u{1F40D} [python-enforcement] This project uses ${ALLOWED_PYTHON_MANAGER}. Please do not use ${usedForbiddenPython}.`;
  }
  return null;
};
var handler = (payload) => {
  const toolName = payload.toolName || "";
  const toolInput = payload.toolInput || {};
  let command = "";
  if (/^(Bash|run_command|shell|terminal|run_shell_command)$/i.test(toolName)) {
    command = toolInput.command || toolInput.cmd || toolInput.commandLine || (typeof toolInput === "string" ? toolInput : "");
  }
  if (!command) {
    return;
  }
  const violation = checkCommand(command);
  if (violation) {
    process.stderr.write(`[ai-hooks:pkg-manager-enforcement] blocked command: ${command}
`);
    return { decision: "deny", reason: violation };
  }
  return;
};
if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
export {
  checkCommand,
  handler
};
