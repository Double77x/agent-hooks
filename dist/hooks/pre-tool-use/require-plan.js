// src/hooks/pre-tool-use/require-plan.ts
import * as path2 from "node:path";

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

// src/utils/state.ts
import * as fs from "node:fs";
import * as path from "node:path";
var getStateDir = () => {
  const dir = path.join(process.cwd(), ".ai-hooks", "state");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};
var readState = (key, defaultValue) => {
  try {
    const file = path.join(getStateDir(), `${key}.json`);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (err) {
    process.stderr.write(`[ai-hooks:state] Error reading state '${key}': ${err.message}
`);
  }
  return defaultValue;
};
var writeState = (key, value) => {
  try {
    const file = path.join(getStateDir(), `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch (err) {
    process.stderr.write(`[ai-hooks:state] Error writing state '${key}': ${err.message}
`);
  }
};

// src/hooks/pre-tool-use/require-plan.ts
var PLAN_KEYWORDS = ["plan", "strategy", "approach", "implementation details"];
var checkPlanRequirement = (payload) => {
  const toolName = payload.toolName || "";
  const input = payload.toolInput || {};
  const isEditTool = /^(Write|Edit|replace|write_file|edit_file)$/i.test(toolName);
  const isThoughtTool = /^(thought|plan|strategy|update_topic)$/i.test(toolName);
  let planProvided = readState("plan_provided", false);
  if (isThoughtTool) {
    const content = typeof input === "string" ? input : JSON.stringify(input);
    if (PLAN_KEYWORDS.some((k) => content.toLowerCase().includes(k))) {
      planProvided = true;
      writeState("plan_provided", true);
    }
  }
  if (isEditTool && !planProvided) {
    if (toolName.toLowerCase().includes("write")) {
      return {
        decision: "ask",
        reason: "\u{1F4DD} [workflow] You are about to perform a significant edit. Please provide a clear plan/strategy first."
      };
    }
  }
  return { decision: "allow" };
};
var handler = (payload) => {
  const { decision, reason } = checkPlanRequirement(payload);
  if (decision !== "allow") {
    process.stderr.write(`[ai-hooks:require-plan] Requesting plan before proceeding with ${payload.toolName}
`);
    return { decision, reason };
  }
  return;
};
if (import.meta.url.endsWith(path2.basename(process.argv[1] || ""))) {
  runHook(handler);
}
export {
  checkPlanRequirement,
  handler
};
