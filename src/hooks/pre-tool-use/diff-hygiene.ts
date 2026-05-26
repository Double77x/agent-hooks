import * as path from "node:path";
import type { AgentPayload, PermissionDecision } from "@/types/index.js";
import { runHook } from "@/utils/hook-wrapper.js";

const HYGIENE_RULES = [
  {
    id: "stray-logs",
    maxLines: undefined,
    reason: "Stray debug logs or debugger statements detected.",
    regex: /console\.log\(|print\(|debugger;/u,
  },
  {
    id: "unfinished-comments",
    maxLines: undefined,
    reason: "Unfinished TODO/FIXME comments detected.",
    regex: /\/\/\s*TODO|\/\/\s*FIXME|#\s*TODO|#\s*FIXME/iu,
  },
  {
    id: "oversized-change",
    maxLines: 500,
    reason: "Change exceeds 500 lines. Consider breaking it down.",
    regex: undefined,
  },
];

export const checkDiffHygiene = (payload: AgentPayload): { decision: PermissionDecision; reason?: string } => {
  const toolName = payload.toolName || "";
  const toolInput = (payload.toolInput as Record<string, unknown>) || {};

  // Check during write/edit operations or before finishing
  const isMutation = /^(Write|Edit|replace|write_file|edit_file)$/i.test(toolName);
  const isFinish = /^(finish|done|complete_task|submit)$/i.test(toolName);

  if (!isMutation && !isFinish) {
    return { decision: "allow" };
  }

  let content = (toolInput.content ||
    toolInput.new_string ||
    toolInput.text ||
    toolInput.CodeContent ||
    toolInput.ReplacementContent ||
    "") as string;
  if (toolInput.ReplacementChunks && Array.isArray(toolInput.ReplacementChunks)) {
    const chunks = toolInput.ReplacementChunks as Record<string, unknown>[];
    content += "\n" + chunks.map((c) => (c.ReplacementContent as string) || "").join("\n");
  }

  if (content) {
    for (const rule of HYGIENE_RULES) {
      if (rule.regex && rule.regex.test(content)) {
        return { decision: "ask", reason: `🧹 [diff-hygiene] ${rule.reason}` };
      }
      if (rule.maxLines && content.split("\n").length > rule.maxLines) {
        return { decision: "ask", reason: `🧹 [diff-hygiene] ${rule.reason}` };
      }
    }
  }

  return { decision: "allow" };
};

export const handler = (payload: AgentPayload) => {
  const { decision, reason } = checkDiffHygiene(payload);

  if (decision !== "allow") {
    process.stderr.write(`[ai-hooks:diff-hygiene] Flagged content: ${reason}\n`);
    return { decision, reason };
  }

  return;
};

if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
