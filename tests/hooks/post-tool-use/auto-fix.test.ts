import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { execSync } from "node:child_process";

import { runFixes } from "@/hooks/post-tool-use/auto-fix.js";

// Mock the dependencies
vi.mock("node:fs");
vi.mock("node:child_process");

describe("Auto-Fix Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects Node.js project and runs oxlint/oxfmt", () => {
    (fs.existsSync as any).mockImplementation((path: string) => path === "package.json");

    const results = runFixes();

    expect(results.map((r) => r.cmd)).toContain("npx oxlint --fix .");
    expect(results.map((r) => r.cmd)).toContain("npx oxfmt .");
    expect(execSync).toHaveBeenCalled();
  });

  it("detects Python project and runs ruff/ty", () => {
    (fs.existsSync as any).mockImplementation((path: string) => path === "uv.lock");

    const results = runFixes();

    expect(results.map((r) => r.cmd)).toContain("ruff check --fix .");
    expect(results.map((r) => r.cmd)).toContain("ty check .");
    expect(execSync).toHaveBeenCalled();
  });
});
