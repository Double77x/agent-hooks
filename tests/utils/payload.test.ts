import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPayload } from "@/utils/payload.js";

describe("Payload Utility", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses Claude adapter by default", () => {
    const raw = { tool_name: "test" };
    const payload = getPayload(raw);
    expect(payload.toolName).toBe("test");
  });

  it("uses Codex adapter when AI_AGENT_TYPE is codex", () => {
    process.env.AI_AGENT_TYPE = "codex";
    const raw = { name: "test-codex" };
    const payload = getPayload(raw);
    expect(payload.toolName).toBe("test-codex");
  });

  it("uses AGY adapter when AI_AGENT_TYPE is agy", () => {
    process.env.AI_AGENT_TYPE = "agy";
    const raw = { tool: "test-agy" };
    const payload = getPayload(raw);
    expect(payload.toolName).toBe("test-agy");
  });
});
