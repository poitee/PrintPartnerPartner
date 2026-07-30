import type { AssistantChatMessage, AssistantProposedAction } from "@print-partner/contracts";
import { ASSISTANT_TOOL_SPECS, invokeAssistantTool, type ToolContext } from "./tools.js";
import {
  parseTextEmbeddedToolCalls,
  stripEmbeddedToolCallJson,
} from "./parse-text-tool-calls.js";
import { recoverProposedActionsFromText } from "./recover-proposals-from-text.js";
import { suggestSoftStackActions } from "./stack-suggest.js";
import { buildSyncThenUpdateAction } from "./sync-then-update.js";
import { loadKitCatalog } from "../services/kit-catalog.js";
import type {
  AssistantPort,
  AssistantToolCallRequest,
  AssistantToolMessage,
  AssistantTurnResult,
} from "./types.js";

function appendSoftStackSuggestions(
  toolCtx: ToolContext,
  proposedActions: AssistantProposedAction[],
): void {
  if (toolCtx.activePlanId == null) return;
  const soft = suggestSoftStackActions({
    repo: toolCtx.repo,
    planId: toolCtx.activePlanId,
    existingActions: proposedActions,
  });
  if (soft.length) proposedActions.push(...soft);
}

/**
 * If the turn proposed set_base with a tag/branch but no sync workflow yet,
 * append a Sync → Update build card so the user isn't left narrating sync.
 */
export function appendSyncThenUpdateIfNeeded(
  toolCtx: ToolContext,
  proposedActions: AssistantProposedAction[],
): void {
  const planId = toolCtx.activePlanId;
  if (planId == null) return;
  if (
    proposedActions.some(
      (a) =>
        a.type === "start_sync" ||
        (a.type === "apply_build_recipe" &&
          a.params?.workflow === "sync_then_recompute"),
    )
  ) {
    return;
  }
  const setBase = proposedActions.find((a) => a.type === "set_base");
  const stackPreset = proposedActions.find((a) => a.type === "apply_stack_preset");
  if (!setBase && !stackPreset) return;
  const tag = typeof setBase?.params?.tag === "string" ? setBase.params.tag.trim() : "";
  const branch =
    typeof setBase?.params?.branch === "string" ? setBase.params.branch.trim() : "";
  // Stack presets (e.g. ldo_trident_r2) often imply a release tag — always offer Sync → Update.
  if (!stackPreset && !tag && !branch) return;

  const names = new Set<string>();
  for (const a of proposedActions) {
    if (a.type !== "set_base" && a.type !== "add_addon") continue;
    const n = a.params?.source_name;
    if (typeof n === "string" && n.trim()) names.add(n.trim());
  }
  // Prefer the catalog base for stack presets when set_base wasn't also proposed.
  if (stackPreset && names.size === 0) {
    try {
      const catalog = loadKitCatalog() as Record<string, unknown>;
      const presets = catalog.stack_presets as
        | Record<string, { base?: string }>
        | undefined;
      const bases = catalog.bases as Record<string, { source_name?: string }> | undefined;
      const presetId =
        typeof stackPreset.params?.preset_id === "string"
          ? stackPreset.params.preset_id
          : "";
      const baseKey = presetId && presets?.[presetId]?.base;
      const baseName = baseKey ? bases?.[baseKey]?.source_name : undefined;
      if (baseName) names.add(baseName);
    } catch {
      /* catalog optional for sync targeting */
    }
  }
  const projectIds: number[] = [];
  for (const name of names) {
    const src = toolCtx.repo.listSources().find((s) => s.name === name);
    if (src) projectIds.push(src.id);
  }
  const sourceName =
    typeof setBase?.params?.source_name === "string"
      ? setBase.params.source_name
      : names.size === 1
        ? [...names][0]!
        : null;
  proposedActions.push(
    buildSyncThenUpdateAction({
      planId,
      projectIds,
      sourceName,
    }),
  );
}

function finalizeProposedActions(
  toolCtx: ToolContext,
  proposedActions: AssistantProposedAction[],
): void {
  appendSoftStackSuggestions(toolCtx, proposedActions);
  appendSyncThenUpdateIfNeeded(toolCtx, proposedActions);
}

const MAX_TOOL_ROUNDS = 4;

export type RunAssistantTurnOptions = {
  assistant: AssistantPort;
  system: string;
  messages: AssistantChatMessage[];
  model: string;
  maxTokens: number;
  toolCtx: ToolContext;
};

/**
 * Multi-round tool loop when the provider supports tools; otherwise returns
 * toolsDegraded so the caller can stream a plain completion with stuffed context.
 */
export async function runAssistantTurn(
  options: RunAssistantTurnOptions,
): Promise<AssistantTurnResult> {
  const { assistant, system, messages, model, maxTokens, toolCtx } = options;

  if (!assistant.supportsTools || !assistant.completeWithTools) {
    return { content: "", proposedActions: [], toolsDegraded: true };
  }

  const toolMessages: AssistantToolMessage[] = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const proposedActions: AssistantProposedAction[] = [];
  let lastContent = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const result = await assistant.completeWithTools({
      system,
      messages: toolMessages,
      model,
      maxTokens,
      tools: ASSISTANT_TOOL_SPECS,
    });
    lastContent = result.content || lastContent;

    let toolCalls: AssistantToolCallRequest[] = result.toolCalls;
    let recoveredFromText = false;
    if (toolCalls.length === 0 && result.content) {
      const recovered = parseTextEmbeddedToolCalls(result.content);
      if (recovered.length > 0) {
        toolCalls = recovered;
        recoveredFromText = true;
      }
    }

    if (toolCalls.length === 0) {
      let content = stripEmbeddedToolCallJson(result.content || lastContent);
      if (proposedActions.length === 0 && content) {
        const recovered = await recoverProposedActionsFromText(content, toolCtx);
        if (recovered.actions.length) {
          proposedActions.push(...recovered.actions);
          content = recovered.cleanedContent;
        } else if (recovered.cleanedContent !== content) {
          content = recovered.cleanedContent;
        }
      }
      finalizeProposedActions(toolCtx, proposedActions);
      return {
        content,
        proposedActions,
        toolsDegraded: false,
      };
    }

    toolMessages.push({
      role: "assistant",
      content: recoveredFromText ? "" : result.content || "",
      toolCalls,
    });

    for (const call of toolCalls) {
      const invoked = await invokeAssistantTool(call.name, call.input ?? {}, toolCtx);
      if (invoked.proposedAction) {
        proposedActions.push(invoked.proposedAction);
      }
      toolMessages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: invoked.content,
      });
    }
  }

  let finalContent = stripEmbeddedToolCallJson(
    lastContent ||
      "I reached the tool-call limit. Please refine your question or try again.",
  );
  if (proposedActions.length === 0 && finalContent) {
    const recovered = await recoverProposedActionsFromText(finalContent, toolCtx);
    if (recovered.actions.length) {
      proposedActions.push(...recovered.actions);
      finalContent = recovered.cleanedContent;
    }
  }

  finalizeProposedActions(toolCtx, proposedActions);

  return {
    content: finalContent,
    proposedActions,
    toolsDegraded: false,
  };
}
