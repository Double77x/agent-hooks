import { describe, it, expect } from "vitest";
import { translateClaude } from "@/adapters/claude.js";

describe("Claude Adapter", () => {
  it("translates standard tool_name/tool_input", () => {
    const raw = {
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };
    const payload = translateClaude(raw);
    expect(payload.toolName).toBe("Bash");
    expect(payload.toolInput).toEqual({ command: "ls" });
  });

  it("translates camelCase toolName/toolInput", () => {
    const raw = {
      toolName: "read_file",
      toolInput: { path: "README.md" },
    };
    const payload = translateClaude(raw);
    expect(payload.toolName).toBe("read_file");
    expect(payload.toolInput).toEqual({ path: "README.md" });
  });

  it("preserves other fields", () => {
    const raw = {
      tool_name: "ls",
      tool_input: {},
      extra: "field",
    };
    const payload = translateClaude(raw);
    expect(payload.extra).toBe("field");
  });
});
