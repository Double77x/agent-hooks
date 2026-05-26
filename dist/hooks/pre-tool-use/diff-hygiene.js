// src/hooks/pre-tool-use/diff-hygiene.ts
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

// src/hooks/pre-tool-use/diff-hygiene.ts
var HYGIENE_RULES = [
  {
    id: "stray-logs",
    maxLines: void 0,
    reason: "Stray debug logs or debugger statements detected.",
    regex: /console\.log\(|print\(|debugger;/u
  },
  {
    id: "unfinished-comments",
    maxLines: void 0,
    reason: "Unfinished TODO/FIXME comments detected.",
    regex: /\/\/\s*TODO|\/\/\s*FIXME|#\s*TODO|#\s*FIXME/iu
  },
  {
    id: "oversized-change",
    maxLines: 500,
    reason: "Change exceeds 500 lines. Consider breaking it down.",
    regex: void 0
  }
];
var checkDiffHygiene = (payload) => {
  const toolName = payload.toolName || "";
  const toolInput = payload.toolInput || {};
  const isMutation = /^(Write|Edit|replace|write_file|edit_file)$/i.test(toolName);
  const isFinish = /^(finish|done|complete_task|submit)$/i.test(toolName);
  if (!isMutation && !isFinish) {
    return { decision: "allow" };
  }
  let content = toolInput.content || toolInput.new_string || toolInput.text || toolInput.CodeContent || toolInput.ReplacementContent || "";
  if (toolInput.ReplacementChunks && Array.isArray(toolInput.ReplacementChunks)) {
    const chunks = toolInput.ReplacementChunks;
    content += "\n" + chunks.map((c) => c.ReplacementContent || "").join("\n");
  }
  if (content) {
    for (const rule of HYGIENE_RULES) {
      if (rule.regex && rule.regex.test(content)) {
        return { decision: "ask", reason: `\u{1F9F9} [diff-hygiene] ${rule.reason}` };
      }
      if (rule.maxLines && content.split("\n").length > rule.maxLines) {
        return { decision: "ask", reason: `\u{1F9F9} [diff-hygiene] ${rule.reason}` };
      }
    }
  }
  return { decision: "allow" };
};
var handler = (payload) => {
  const { decision, reason } = checkDiffHygiene(payload);
  if (decision !== "allow") {
    process.stderr.write(`[ai-hooks:diff-hygiene] Flagged content: ${reason}
`);
    return { decision, reason };
  }
  return;
};
if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
export {
  checkDiffHygiene,
  handler
};
