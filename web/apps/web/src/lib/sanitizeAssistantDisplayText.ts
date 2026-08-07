/**
 * Clean model scaffolding / leftover JSON fragments from assistant chat text
 * for history reload and bubble display (mirrors server sanitize-display-text).
 */
export function sanitizeAssistantDisplayText(content: string): string {
  let out = content;
  out = out.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, "");
  out = out.replace(/^\s*[}\]]+\s*$/gm, "");
  out = out.replace(/\n\s*[}\]]{1,4}\s*$/g, "");
  out = out.replace(
    /\bTo apply these settings, click[\s\S]*?(?:proceed|build|UI)\.?\s*/gi,
    "",
  );
  out = out.replace(/\bPlease confirm to proceed[\s\S]*?(?:\n|$)/gi, "");
  out = out.replace(
    /\bHere is an example of what the build recipe[\s\S]*?(?=\n\n|$)/gi,
    "",
  );
  out = out.replace(/\bPlease note that this is just an example[\s\S]*?(?=\n\n|$)/gi, "");
  // Strip UI agency breadcrumbs that used to pollute history
  out = out.replace(/\n\n↗ [^\n]+/g, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
