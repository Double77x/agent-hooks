import { describe, it, expect } from "vitest";
import { checkDiffHygiene } from "@/hooks/pre-tool-use/diff-hygiene.js";

describe("Diff Hygiene Hook", () => {
  it("blocks stray console.logs", () => {
    const payload = {
      toolName: "write_file",
      toolInput: { content: 'function test() { console.log("debug"); }' },
    };
    const result = checkDiffHygiene(payload);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("Stray debug logs");
  });

  it("blocks unfinished TODOs", () => {
    const payload = {
      toolName: "write_file",
      toolInput: { content: "// TODO: implement this" },
    };
    const result = checkDiffHygiene(payload);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("Unfinished TODO/FIXME");
  });

  it("blocks oversized changes", () => {
    const payload = {
      toolName: "write_file",
      toolInput: { content: "line\n".repeat(501) },
    };
    const result = checkDiffHygiene(payload);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("exceeds 500 lines");
  });

  it("allows clean code", () => {
    const payload = {
      toolName: "write_file",
      toolInput: { content: "function test() { return true; }" },
    };
    const result = checkDiffHygiene(payload);
    expect(result.decision).toBe("allow");
  });
});
