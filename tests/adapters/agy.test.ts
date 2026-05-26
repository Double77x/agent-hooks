import { describe, it, expect } from "vitest";
import { translateAGY } from "@/adapters/agy.js";

describe("AGY Adapter", () => {
  it("translates tool/input", () => {
    const raw = {
      tool: "shell",
      input: { command: "echo hello" },
    };
    const payload = translateAGY(raw);
    expect(payload.toolName).toBe("shell");
    expect(payload.toolInput).toEqual({ command: "echo hello" });
  });

  it("translates name/args", () => {
    const raw = {
      name: "write",
      args: { path: "a.ts" },
    };
    const payload = translateAGY(raw);
    expect(payload.toolName).toBe("write");
    expect(payload.toolInput).toEqual({ path: "a.ts" });
  });

  it("preserves other fields", () => {
    const raw = {
      tool: "ls",
      input: {},
      context: "local",
    };
    const payload = translateAGY(raw);
    expect(payload.context).toBe("local");
  });
});
