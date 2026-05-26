/**
 * Splitting shell commands is tricky because of quotes.
 * This version uses a state machine approach to respect single and double quotes.
 */
export function splitShellCommands(cmd: string): string[] {
  const result: string[] = [];
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

    // Check for command delimiters outside of quotes
    if (!inDoubleQuote && !inSingleQuote) {
      const nextTwo = cmd.slice(i, i + 2);
      if (nextTwo === "&&" || nextTwo === "||") {
        if (current.trim()) result.push(current.trim());
        current = "";
        i++; // skip next char
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

export function normalizeCommand(cmd: string): string {
  return (cmd || "")
    .replace(/\s+/g, " ")
    .replace(/^(?:env\s+)?(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/g, "")
    .trim();
}

export function unwrapShellCommand(cmd: string): string {
  // Matches: bash -c "..." or sh -c '...'
  const m = cmd.match(/\b(?:bash|sh|zsh)\b\s+-c\s+(["'])([\s\S]+)\1$/);
  if (m && m[2]) {
    return normalizeCommand(m[2]);
  }
  return cmd;
}
