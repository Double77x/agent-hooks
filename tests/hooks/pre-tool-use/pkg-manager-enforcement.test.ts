import { describe, it, expect } from "vitest";
import { checkCommand } from "@/hooks/pre-tool-use/pkg-manager-enforcement.js";

describe("Package Manager Enforcement Hook", () => {
  it("blocks forbidden node managers (default pnpm)", () => {
    expect(checkCommand("npm install")).toContain("uses pnpm");
    expect(checkCommand("yarn add lodash")).toContain("uses pnpm");
  });

  it("blocks forbidden python managers (default uv)", () => {
    expect(checkCommand("pip install requests")).toContain("uses uv");
    expect(checkCommand("poetry add flask")).toContain("uses uv");
  });

  it("allows the selected managers", () => {
    expect(checkCommand("pnpm install")).toBeNull();
    expect(checkCommand("uv sync")).toBeNull();
  });

  it("handles complex commands", () => {
    expect(checkCommand("echo hello && npm install")).toContain("uses pnpm");
  });
});
