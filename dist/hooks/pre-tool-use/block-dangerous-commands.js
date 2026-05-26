// src/hooks/pre-tool-use/block-dangerous-commands.ts
import * as fs from "node:fs";
import * as path from "node:path";

// src/utils/shell.ts
function splitShellCommands(cmd) {
  const result = [];
  let current = "";
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;
  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    if (!inDoubleQuote && !inSingleQuote) {
      const nextTwo = cmd.slice(i, i + 2);
      if (nextTwo === "&&" || nextTwo === "||") {
        if (current.trim()) result.push(current.trim());
        current = "";
        i++;
        continue;
      }
      if (char === ";" || char === "\n" || char === "|") {
        if (current.trim()) result.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result.filter(Boolean);
}
function normalizeCommand(cmd) {
  return (cmd || "").replace(/\s+/g, " ").replace(/^(?:env\s+)?(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/g, "").trim();
}
function unwrapShellCommand(cmd) {
  const m = cmd.match(/\b(?:bash|sh|zsh)\b\s+-c\s+(["'])([\s\S]+)\1$/);
  if (m && m[2]) {
    return normalizeCommand(m[2]);
  }
  return cmd;
}

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

// src/hooks/pre-tool-use/block-dangerous-commands.ts
var MODE = process.env.AI_HOOK_MODE || "deny";
var LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".ai-hooks", "logs");
var HARD_BLOCKS = [
  { id: "rm-root", reason: "rm targeting root filesystem", regex: /\brm\b(?:\s+[-\w]+)*\s+\/(?:\s|$|[;&|])/u },
  {
    id: "rm-home",
    reason: "rm targeting home directory",
    regex: /\brm\b(?:\s+[-\w]+)*\s+(~\/?|\$HOME)(?:\s|$|[;&|])/u
  },
  {
    id: "rm-system",
    reason: "rm targeting critical system directory",
    regex: /\brm\b(?:\s+[-\w]+)*\s+\/(?:etc|usr|var|bin|sbin|lib|boot|dev|proc|sys)(?:\/|\s|$)/u
  },
  {
    id: "dd-disk",
    reason: "dd writing to block device",
    regex: /\bdd\b.*\bof=\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|vd[a-z]\d*|xvd[a-z]\d*|nvme\d+n\d+(?:p\d+)?)(?:\s|$)/u
  },
  {
    id: "mkfs-device",
    reason: "filesystem format on block device",
    regex: /\bmkfs(?:\.\w+)?\b\s+\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|vd[a-z]\d*|xvd[a-z]\d*|nvme\d+n\d+(?:p\d+)?)(?:\s|$)/u
  },
  { id: "fork-bomb", reason: "fork bomb detected", regex: /:\(\)\s*\{[^}]*:\s*\|\s*:\s*&\s*\}/u },
  {
    id: "curl-pipe-shell",
    reason: "piping remote content to shell",
    regex: /\b(?:curl|wget)\b.*\|\s*(?:bash|sh|zsh)\b/u
  },
  {
    id: "shell-c-remote",
    reason: "shell executing remote script directly",
    regex: /\b(?:bash|sh|zsh)\b\s+-c\s+["'][^"']*(?:curl|wget)[^"']*\|\s*(?:bash|sh|zsh)\b/u
  }
];
var logToFile = (entry) => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), ...entry }) + "\n");
  } catch {
  }
};
var findViolation = (raw) => {
  const normalized = normalizeCommand(raw);
  const unwrapped = unwrapShellCommand(normalized);
  const candidates = [normalized, unwrapped, ...splitShellCommands(normalized), ...splitShellCommands(unwrapped)];
  for (const candidate of candidates) {
    for (const rule of HARD_BLOCKS) {
      if (rule.regex.test(candidate)) {
        return { inspected: candidate, rule };
      }
    }
  }
  return null;
};
var extractToolData = (payload) => {
  const toolName = payload.toolName || "";
  const input = payload.toolInput || {};
  const command = typeof input === "string" ? input : input.command || input.cmd || input.commandLine || input.CommandLine || input.raw_command || "";
  return { command, toolName };
};
var isShellTool = (toolName) => {
  return /^(Bash|run_command|shell|terminal|run_shell_command)$/i.test(toolName);
};
var handler = (payload) => {
  const { command, toolName } = extractToolData(payload);
  if (!isShellTool(toolName) || !command) {
    return;
  }
  const violation = findViolation(command);
  if (!violation) {
    return;
  }
  const reason = `[${violation.rule.id}] ${violation.rule.reason}`;
  const decision = MODE === "ask" ? "ask" : "deny";
  const logEntry = {
    command,
    inspected: violation.inspected,
    level: decision.toUpperCase(),
    reason,
    rule: violation.rule.id,
    toolName
  };
  logToFile(logEntry);
  process.stderr.write(`[ai-hooks:block-dangerous-commands] blocked shell command: ${JSON.stringify(logEntry)}
`);
  return { decision, reason };
};
if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
export {
  extractToolData,
  findViolation,
  handler,
  isShellTool,
  logToFile
};
