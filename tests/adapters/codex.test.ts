import { describe, it, expect } from "vitest";
import { translateCodex } from "@/adapters/codex.js";

describe("Codex Adapter", () => {
  it("translates name/arguments", () => {
    const raw = {
      name: "grep_search",
      arguments: { pattern: "test" },
    };
    const payload = translateCodex(raw);
    expect(payload.toolName).toBe("grep_search");
    expect(payload.toolInput).toEqual({ pattern: "test" });
  });

  it("translates name/args", () => {
    const raw = {
      name: "ls",
      args: { dir: "." },
    };
    const payload = translateCodex(raw);
    expect(payload.toolName).toBe("ls");
    expect(payload.toolInput).toEqual({ dir: "." });
  });

  it("preserves other fields", () => {
    const raw = {
      name: "ls",
      args: {},
      session_id: "123",
    };
    const payload = translateCodex(raw);
    expect(payload.session_id).toBe("123");
  });
});
