// src/hooks/pre-tool-use/protect-secrets.ts
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

// src/hooks/pre-tool-use/protect-secrets.ts
var SAFETY_LEVEL = process.env.AI_SAFETY_LEVEL || "high";
var LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".ai-hooks", "logs");
var loadLocalConfig = () => {
  try {
    const localPath = path.join(process.cwd(), ".ai-hooks-config.json");
    if (fs.existsSync(localPath)) {
      return JSON.parse(fs.readFileSync(localPath, "utf8"));
    }
  } catch {
  }
  return {};
};
var localConfig = loadLocalConfig();
var LOCAL_ALLOWLIST = Array.isArray(localConfig.secretsAllowlist) ? localConfig.secretsAllowlist : [];
var ALLOWLIST = [
  /\.env\.example$/i,
  /\.env\.sample$/i,
  /\.env\.template$/i,
  /\.env\.schema$/i,
  /\.env\.defaults$/i,
  /env\.example$/i,
  /example\.env$/i
];
var SENSITIVE_FILES = [
  // CRITICAL
  { level: "critical", id: "env-file", regex: /(?:^|\/)\.env(?:\.[^/]*)?$/u, reason: ".env file contains secrets" },
  { level: "critical", id: "envrc", regex: /(?:^|\/)\.envrc$/u, reason: ".envrc (direnv) contains secrets" },
  { level: "critical", id: "ssh-private-key", regex: /(?:^|\/)\.ssh\/id_[^/]+$/u, reason: "SSH private key" },
  {
    level: "critical",
    id: "ssh-private-key-2",
    regex: /(?:^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/u,
    reason: "SSH private key"
  },
  { level: "critical", id: "ssh-authorized", regex: /(?:^|\/)\.ssh\/authorized_keys$/u, reason: "SSH authorized_keys" },
  { level: "critical", id: "aws-credentials", regex: /(?:^|\/)\.aws\/credentials$/u, reason: "AWS credentials file" },
  { level: "critical", id: "aws-config", regex: /(?:^|\/)\.aws\/config$/u, reason: "AWS config may contain secrets" },
  {
    level: "critical",
    id: "kube-config",
    regex: /(?:^|\/)\.kube\/config$/u,
    reason: "Kubernetes config contains credentials"
  },
  { level: "critical", id: "pem-key", regex: /\.pem$/iu, reason: "PEM key file" },
  { level: "critical", id: "key-file", regex: /\.key$/iu, reason: "Key file" },
  { level: "critical", id: "p12-key", regex: /\.(p12|pfx)$/iu, reason: "PKCS12 key file" },
  // HIGH
  { level: "high", id: "credentials-json", regex: /(?:^|\/)credentials\.json$/iu, reason: "Credentials file" },
  {
    level: "high",
    id: "secrets-file",
    regex: /(?:^|\/)(secrets?|credentials?)\.(json|ya?ml|toml)$/iu,
    reason: "Secrets configuration file"
  },
  { level: "high", id: "service-account", regex: /service[_-]?account.*\.json$/iu, reason: "GCP service account key" },
  {
    level: "high",
    id: "gcloud-creds",
    regex: /(?:^|\/)\.config\/gcloud\/.*(credentials|tokens)/iu,
    reason: "GCloud credentials"
  },
  {
    level: "high",
    id: "azure-creds",
    regex: /(?:^|\/)\.azure\/(credentials|accessTokens)/iu,
    reason: "Azure credentials"
  },
  {
    level: "high",
    id: "docker-config",
    regex: /(?:^|\/)\.docker\/config\.json$/u,
    reason: "Docker config may contain registry auth"
  },
  { level: "high", id: "netrc", regex: /(?:^|\/)\.netrc$/u, reason: ".netrc contains credentials" },
  { level: "high", id: "npmrc", regex: /(?:^|\/)\.npmrc$/u, reason: ".npmrc may contain auth tokens" },
  { level: "high", id: "pypirc", regex: /(?:^|\/)\.pypirc$/u, reason: ".pypirc contains PyPI credentials" },
  { level: "high", id: "gem-creds", regex: /(?:^|\/)\.gem\/credentials$/u, reason: "RubyGems credentials" },
  { level: "high", id: "vault-token", regex: /(?:^|\/)(\.vault-token|vault-token)$/u, reason: "Vault token file" },
  { level: "high", id: "keystore", regex: /\.(keystore|jks)$/iu, reason: "Java keystore" },
  { level: "high", id: "htpasswd", regex: /(?:^|\/)\.?htpasswd$/u, reason: "htpasswd contains hashed passwords" },
  { level: "high", id: "pgpass", regex: /(?:^|\/)\.pgpass$/u, reason: "PostgreSQL password file" },
  { level: "high", id: "my-cnf", regex: /(?:^|\/)\.my\.cnf$/u, reason: "MySQL config may contain password" },
  // STRICT
  {
    level: "strict",
    id: "database-config",
    regex: /(?:^|\/)(?:config\/)?database\.(json|ya?ml)$/iu,
    reason: "Database config may contain passwords"
  },
  {
    level: "strict",
    id: "ssh-known-hosts",
    regex: /(?:^|\/)\.ssh\/known_hosts$/u,
    reason: "SSH known_hosts reveals infrastructure"
  },
  { level: "strict", id: "gitconfig", regex: /(?:^|\/)\.gitconfig$/u, reason: ".gitconfig may contain credentials" },
  { level: "strict", id: "curlrc", regex: /(?:^|\/)\.curlrc$/u, reason: ".curlrc may contain auth" }
];
var BASH_PATTERNS = [
  // CRITICAL
  {
    level: "critical",
    id: "cat-env",
    regex: /\b(cat|less|head|tail|more|bat|view)\s+[^|;]*\.env\b/iu,
    reason: "Reading .env file exposes secrets"
  },
  {
    level: "critical",
    id: "cat-ssh-key",
    regex: /\b(cat|less|head|tail|more|bat)\s+[^|;]*(id_rsa|id_ed25519|id_ecdsa|id_dsa|\.pem|\.key)\b/iu,
    reason: "Reading private key"
  },
  {
    level: "critical",
    id: "cat-aws-creds",
    regex: /\b(cat|less|head|tail|more)\s+[^|;]*\.aws\/credentials/iu,
    reason: "Reading AWS credentials"
  },
  // HIGH - Environment exposure
  {
    level: "high",
    id: "env-dump",
    regex: /\bprintenv\b|(?:^|[;&|]\s*)env\s*(?:$|[;&|])/u,
    reason: "Environment dump may expose secrets"
  },
  {
    level: "high",
    id: "echo-secret-var",
    regex: /\becho\b[^;|&]*\$\{?[A-Za-z_]*(?:SECRET|KEY|TOKEN|PASSWORD|PASSW|CREDENTIAL|API_KEY|AUTH|PRIVATE)[A-Za-z_]*\}?/iu,
    reason: "Echoing secret variable"
  },
  {
    level: "high",
    id: "printf-secret-var",
    regex: /\bprintf\b[^;|&]*\$\{?[A-Za-z_]*(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|API_KEY|AUTH|PRIVATE)[A-Za-z_]*\}?/iu,
    reason: "Printing secret variable"
  },
  {
    level: "high",
    id: "cat-secrets-file",
    regex: /\b(cat|less|head|tail|more)\s+[^|;]*(credentials?|secrets?)\.(json|ya?ml|toml)/iu,
    reason: "Reading secrets file"
  },
  {
    level: "high",
    id: "cat-netrc",
    regex: /\b(cat|less|head|tail|more)\s+[^|;]*\.netrc/iu,
    reason: "Reading .netrc credentials"
  },
  {
    level: "high",
    id: "source-env",
    regex: /\bsource\s+[^|;]*\.env\b|(?:^|[;&|]\s*)\.\s+[^|;]*\.env\b/iu,
    reason: "Sourcing .env loads secrets"
  },
  {
    level: "high",
    id: "export-cat-env",
    regex: /export\s+.*\$\(cat\s+[^)]*\.env/iu,
    reason: "Exporting secrets from .env"
  },
  // HIGH - Exfiltration
  {
    level: "high",
    id: "curl-upload-env",
    regex: /\bcurl\b[^;|&]*(-d\s*@|-F\s*[^=]+=@|--data[^=]*=@)[^;|&]*(\.env|credentials|secrets|id_rsa|\.pem|\.key)/iu,
    reason: "Uploading secrets via curl"
  },
  {
    level: "high",
    id: "curl-post-secrets",
    regex: /\bcurl\b[^;|&]*-X\s*POST[^;|&]*[^;|&]*(\.env|credentials|secrets)/iu,
    reason: "POSTing secrets via curl"
  },
  {
    level: "high",
    id: "wget-post-secrets",
    regex: /\bwget\b[^;|&]*--post-file[^;|&]*(\.env|credentials|secrets)/iu,
    reason: "POSTing secrets via wget"
  },
  {
    level: "high",
    id: "scp-secrets",
    regex: /\bscp\b[^;|&]*(\.env|credentials|secrets|id_rsa|\.pem|\.key)[^;|&]+:/iu,
    reason: "Copying secrets via scp"
  },
  {
    level: "high",
    id: "rsync-secrets",
    regex: /\brsync\b[^;|&]*(\.env|credentials|secrets|id_rsa)[^;|&]+:/iu,
    reason: "Syncing secrets via rsync"
  },
  {
    level: "high",
    id: "nc-secrets",
    regex: /\bnc\b[^;|&]*<[^;|&]*(\.env|credentials|secrets|id_rsa)/iu,
    reason: "Exfiltrating secrets via netcat"
  },
  // HIGH - Copy/move/delete secrets
  { level: "high", id: "cp-env", regex: /\bcp\b[^;|&]*\.env\b/iu, reason: "Copying .env file" },
  {
    level: "high",
    id: "cp-ssh-key",
    regex: /\bcp\b[^;|&]*(id_rsa|id_ed25519|\.pem|\.key)\b/iu,
    reason: "Copying private key"
  },
  { level: "high", id: "mv-env", regex: /\bmv\b[^;|&]*\.env\b/iu, reason: "Moving .env file" },
  {
    level: "high",
    id: "rm-ssh-key",
    regex: /\brm\b[^;|&]*(id_rsa|id_ed25519|id_ecdsa|authorized_keys)/iu,
    reason: "Deleting SSH key"
  },
  { level: "high", id: "rm-env", regex: /\brm\b.*\.env\b/iu, reason: "Deleting .env file" },
  { level: "high", id: "rm-aws-creds", regex: /\brm\b[^;|&]*\.aws\/credentials/iu, reason: "Deleting AWS credentials" },
  {
    level: "high",
    id: "truncate-secrets",
    regex: /\btruncate\b.*\.(env|pem|key)\b|(?:^|[;&|]\s*)>\s*\.env\b/iu,
    reason: "Truncating secrets file"
  },
  // HIGH - Process environ
  { level: "high", id: "proc-environ", regex: /\/proc\/[^/]*\/environ/u, reason: "Reading process environment" },
  { level: "high", id: "xargs-cat-env", regex: /xargs.*cat|\.env.*xargs/iu, reason: "Reading .env via xargs" },
  {
    level: "high",
    id: "find-exec-cat-env",
    regex: /find\b.*\.env.*-exec|find\b.*-exec.*(cat|less)/iu,
    reason: "Finding and reading .env files"
  },
  // STRICT
  {
    level: "strict",
    id: "grep-password",
    regex: /\bgrep\b[^|;]*(-r|--recursive)[^|;]*(password|secret|api.?key|token|credential)/iu,
    reason: "Grep for secrets may expose them"
  },
  {
    level: "strict",
    id: "base64-secrets",
    regex: /\bbase64\b[^|;]*(\.env|credentials|secrets|id_rsa|\.pem)/iu,
    reason: "Base64 encoding secrets"
  }
];
var LEVELS = { critical: 1, high: 2, strict: 3 };
var EMOJIS = { critical: "\u{1F510}", high: "\u{1F6E1}\uFE0F", strict: "\u26A0\uFE0F" };
var logToFile = (entry) => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ hook: "protect-secrets", ts: (/* @__PURE__ */ new Date()).toISOString(), ...entry }) + "\n");
  } catch {
  }
};
var isAllowlisted = (filePath) => {
  if (!filePath) return false;
  if (LOCAL_ALLOWLIST.includes(filePath)) return true;
  return ALLOWLIST.some((p) => p.test(filePath));
};
var checkFilePath = (filePath, safetyLevel = SAFETY_LEVEL) => {
  if (!filePath || isAllowlisted(filePath)) return null;
  const threshold = LEVELS[safetyLevel];
  for (const rule of SENSITIVE_FILES) {
    if (LEVELS[rule.level] <= threshold && rule.regex.test(filePath)) {
      return rule;
    }
  }
  return null;
};
var checkBashCommand = (cmd, safetyLevel = SAFETY_LEVEL) => {
  if (!cmd) return null;
  const normalized = normalizeCommand(cmd);
  const unwrapped = unwrapShellCommand(normalized);
  const candidates = [normalized, unwrapped, ...splitShellCommands(normalized), ...splitShellCommands(unwrapped)];
  const threshold = LEVELS[safetyLevel];
  for (const candidate of candidates) {
    for (const rule of BASH_PATTERNS) {
      if (LEVELS[rule.level] <= threshold && rule.regex.test(candidate)) {
        return rule;
      }
    }
  }
  return null;
};
var handler = (payload) => {
  const toolName = payload.toolName || "";
  const toolInput = payload.toolInput || {};
  let violation = null;
  let target = "";
  if (["Read", "Edit", "Write", "read_file", "replace", "write_file"].includes(toolName)) {
    const filePath = toolInput.file_path || toolInput.path || (typeof toolInput === "string" ? toolInput : "");
    violation = checkFilePath(filePath);
    target = filePath;
  } else if (/^(Bash|run_command|shell|terminal|run_shell_command)$/i.test(toolName)) {
    const command = toolInput.command || toolInput.cmd || toolInput.commandLine || (typeof toolInput === "string" ? toolInput : "");
    violation = checkBashCommand(command);
    target = command.slice(0, 100);
  }
  if (violation) {
    const decision = "deny";
    const reason = `${EMOJIS[violation.level]} [${violation.id}] ${violation.reason}`;
    const logEntry = {
      id: violation.id,
      level: "BLOCKED",
      priority: violation.level,
      reason,
      target,
      tool: toolName
    };
    logToFile(logEntry);
    process.stderr.write(`[ai-hooks:protect-secrets] Blocked secret access: ${JSON.stringify(logEntry)}
`);
    return { decision, reason };
  }
  return;
};
if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
export {
  checkBashCommand,
  checkFilePath,
  handler,
  isAllowlisted,
  logToFile
};
