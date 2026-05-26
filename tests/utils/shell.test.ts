import { describe, it, expect } from "vitest";
import { splitShellCommands, normalizeCommand, unwrapShellCommand } from "@/utils/shell.js";

describe("Shell Utilities", () => {
  describe("splitShellCommands", () => {
    it("splits simple commands by semicolon", () => {
      expect(splitShellCommands("ls; pwd")).toEqual(["ls", "pwd"]);
    });

    it("splits by && and ||", () => {
      expect(splitShellCommands("ls && pwd || echo fail")).toEqual(["ls", "pwd", "echo fail"]);
    });

    it("respects double quotes", () => {
      expect(splitShellCommands('echo "hello; world"; ls')).toEqual(['echo "hello; world"', "ls"]);
    });

    it("respects single quotes", () => {
      expect(splitShellCommands("echo 'stay | safe' | bash")).toEqual(["echo 'stay | safe'", "bash"]);
    });

    it("handles escaped characters", () => {
      expect(splitShellCommands("echo hello\\; world; ls")).toEqual(["echo hello\\; world", "ls"]);
    });
  });

  describe("normalizeCommand", () => {
    it("trims and reduces whitespace", () => {
      expect(normalizeCommand("  ls    -la  ")).toBe("ls -la");
    });

    it("removes environment variable prefixes", () => {
      expect(normalizeCommand("NODE_ENV=production ls")).toBe("ls");
      expect(normalizeCommand("DEBUG=true PORT=8080 npm start")).toBe("npm start");
    });
  });

  describe("unwrapShellCommand", () => {
    it("unwraps bash -c commands", () => {
      expect(unwrapShellCommand('bash -c "ls -la"')).toBe("ls -la");
    });

    it("unwraps sh -c commands with single quotes", () => {
      expect(unwrapShellCommand("sh -c 'rm -rf /'")).toBe("rm -rf /");
    });

    it("returns the same command if not a shell wrapper", () => {
      expect(unwrapShellCommand("ls -la")).toBe("ls -la");
    });
  });
});
