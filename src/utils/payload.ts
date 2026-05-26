import type { AgentPayload } from "@/types/index.js";
import { translateClaude } from "@/adapters/claude.js";
import { translateCodex } from "@/adapters/codex.js";
import { translateAGY } from "@/adapters/agy.js";

export const getPayload = (raw: unknown): AgentPayload => {
  const type = (process.env.AI_AGENT_TYPE || "claude").toLowerCase().trim();
  switch (type) {
    case "codex":
      return translateCodex(raw);
    case "agy":
      return translateAGY(raw);
    case "claude":
    default:
      return translateClaude(raw);
  }
};
