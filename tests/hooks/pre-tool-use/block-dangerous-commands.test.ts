import { describe, it, expect } from "vitest";
import { findViolation, isShellTool, handler } from "@/hooks/pre-tool-use/block-dangerous-commands.js";

describe("Block Dangerous Commands Hook", () => {
  describe("isShellTool", () => {
    it("identifies shell tools", () => {
      expect(isShellTool("Bash")).toBe(true);
      expect(isShellTool("run_shell_command")).toBe(true);
      expect(isShellTool("terminal")).toBe(true);
      expect(isShellTool("NotAShell")).toBe(false);
    });
  });

  describe("findViolation", () => {
    it("blocks rm -rf /", () => {
      const v = findViolation("rm -rf /");
      expect(v).not.toBeNull();
      expect(v?.rule.id).toBe("rm-root");
    });

    it("blocks fork bomb", () => {
      const v = findViolation(":(){ :|:& };:");
      expect(v).not.toBeNull();
      expect(v?.rule.id).toBe("fork-bomb");
    });

    it("allows safe commands", () => {
      expect(findViolation("ls -la")).toBeNull();
      expect(findViolation('echo "rm -rf /"')).toBeNull();
    });
  });

  describe("handler", () => {
    it("returns a deny result for dangerous commands", () => {
      const payload = {
        toolName: "Bash",
        toolInput: { command: "rm -rf /" },
      };
      const result = handler(payload as any);
      expect(result?.decision).toBe("deny");
      expect(result?.reason).toContain("rm-root");
    });

    it("returns undefined (allow) for safe commands", () => {
      const payload = {
        toolName: "Bash",
        toolInput: { command: "ls" },
      };
      const result = handler(payload as any);
      expect(result).toBeUndefined();
    });
  });
});
