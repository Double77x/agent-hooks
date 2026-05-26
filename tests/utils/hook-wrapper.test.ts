import { describe, it, expect, vi, beforeEach } from "vitest";
import { runHook } from "@/utils/hook-wrapper.js";

describe("Hook Wrapper", () => {
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.exitCode = undefined;
  });

  const mockStdin = (content: string) => {
    const iterable = (async function* () {
      yield content;
    })();
    vi.spyOn(process.stdin, "setEncoding").mockReturnThis();
    // @ts-ignore
    process.stdin[Symbol.asyncIterator] = () => iterable[Symbol.asyncIterator]();
  };

  it("outputs empty JSON for allow/no-op", async () => {
    mockStdin('{"toolName": "ls"}');
    await runHook(() => {});
    expect(stdoutSpy).toHaveBeenCalledWith("{}");
  });

  it("outputs strictly formatted JSON on deny and sets exitCode 2", async () => {
    mockStdin('{"toolName": "rm"}');
    await runHook(async () => ({
      decision: "deny",
      reason: "unsafe",
    }));

    const output = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe("unsafe");
    expect(process.exitCode).toBe(2);
  });

  it("handles parse errors with fail-safe no-op", async () => {
    mockStdin("invalid-json");
    await runHook(() => {});

    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith("{}");
  });

  it("handles handler errors with fail-safe no-op", async () => {
    mockStdin("{}");
    await runHook(() => {
      throw new Error("crash");
    });

    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith("{}");
  });

  it("includes extraOutput in the final JSON", async () => {
    mockStdin("{}");
    await runHook(() => ({
      decision: "allow",
      extraOutput: { foo: "bar" },
    }));

    const output = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.foo).toBe("bar");
    expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
  });
});
