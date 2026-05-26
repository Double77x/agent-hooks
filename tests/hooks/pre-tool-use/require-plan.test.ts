import { describe, it, expect, vi, beforeEach } from "vitest";
import * as state from "@/utils/state.js";
import { checkPlanRequirement } from "@/hooks/pre-tool-use/require-plan.js";

vi.mock("@/utils/state.js", () => ({
  readState: vi.fn(),
  writeState: vi.fn(),
  getStateDir: vi.fn(),
}));

describe("Require Plan Hook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("blocks write_file if no plan was provided", () => {
    vi.mocked(state.readState).mockReturnValue(false);

    const result = checkPlanRequirement({
      toolName: "write_file",
      toolInput: { path: "test.ts", content: "new content" },
    } as any);

    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("Please provide a clear plan");
  });

  it("allows write_file if a plan was already provided in state", () => {
    vi.mocked(state.readState).mockReturnValue(true);

    const result = checkPlanRequirement({
      toolName: "write_file",
      toolInput: { path: "test.ts", content: "new content" },
    } as any);

    expect(result.decision).toBe("allow");
  });

  it("sets plan_provided state when a thought tool includes a plan keyword", () => {
    vi.mocked(state.readState).mockReturnValue(false);

    checkPlanRequirement({
      toolName: "thought",
      toolInput: "I have a strategy for this.",
    } as any);

    expect(state.writeState).toHaveBeenCalledWith("plan_provided", true);
  });
});
