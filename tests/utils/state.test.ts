import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { readState, writeState, getStateDir } from "@/utils/state.js";

vi.mock("node:fs");

describe("State Utility", () => {
  const mockStateDir = path.join(process.cwd(), ".ai-hooks", "state");

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates state directory if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    getStateDir();
    expect(fs.mkdirSync).toHaveBeenCalledWith(mockStateDir, { recursive: true });
  });

  it("reads state from file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ test: true }));

    const val = readState("key", { test: false });
    expect(val).toEqual({ test: true });
    expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining("key.json"), "utf8");
  });

  it("returns default value if file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const val = readState("key", "default");
    expect(val).toBe("default");
  });

  it("writes state to file", () => {
    writeState("key", { updated: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("key.json"),
      expect.stringContaining('"updated": true'),
    );
  });
});
