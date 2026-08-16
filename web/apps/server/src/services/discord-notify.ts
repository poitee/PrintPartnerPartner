import { safeOutboundFetch } from "../lib/outbound-url.js";
import { getLogger } from "./logger.js";

export type DiscordNotifyEvent =
  | "source.synced"
  | "source.updated"
  | "source.sync_failed"
  | "source.update_available"
  | "farm.digest";

const EVENT_META: Record<
  DiscordNotifyEvent,
  { color: number; emoji: string; titleTemplate: string }
> = {
  "source.synced": {
    color: 0x57f287, // green
    emoji: "✅",
    titleTemplate: "{sourceName} synced",
  },
  "source.updated": {
    color: 0x57f287, // green
    emoji: "🔄",
    titleTemplate: "{sourceName} updated",
  },
  "source.sync_failed": {
    color: 0xed4245, // red
    emoji: "❌",
    titleTemplate: "{sourceName} sync failed",
  },
  "source.update_available": {
    color: 0xfee75c, // yellow
    emoji: "⬆️",
    titleTemplate: "Update available: {sourceName}",
  },
  "farm.digest": {
    color: 0x5865f2, // blurple
    emoji: "🌅",
    titleTemplate: "Good morning — farm digest",
  },
};

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

function buildDescription(
  event: DiscordNotifyEvent,
  data: {
    sourceName: string;
    sourceUrl: string;
    branch: string;
    commitSha?: string | null;
    previousSha?: string | null;
    stlCount?: number;
    error?: string;
  },
): string {
  const sha = data.commitSha;
  const short = shortSha(sha);

  switch (event) {
    case "source.synced":
      return [
        `Branch \`${data.branch}\``,
        data.stlCount != null ? `${data.stlCount} STLs` : null,
        sha ? `[${short}](${data.sourceUrl}/commit/${sha})` : null,
      ]
        .filter(Boolean)
        .join(" · ");

    case "source.updated": {
      const prevShort = shortSha(data.previousSha);
      const parts = [`Branch \`${data.branch}\``];
      if (data.stlCount != null) parts.push(`${data.stlCount} STLs`);
      if (sha) {
        if (data.previousSha && data.previousSha !== sha) {
          parts.push(
            `[${prevShort}…${short}](${data.sourceUrl}/compare/${data.previousSha}...${sha})`,
          );
        } else {
          parts.push(`[${short}](${data.sourceUrl}/commit/${sha})`);
        }
      }
      return parts.join(" · ");
    }

    case "source.sync_failed":
      return data.error ? `**Error:** ${data.error}` : "Sync failed — check logs for details.";

    case "source.update_available":
      return [
        `Branch \`${data.branch}\``,
        sha ? `Remote: [${short}](${data.sourceUrl}/commit/${sha})` : null,
      ]
        .filter(Boolean)
        .join(" · ");

    case "farm.digest":
      return data.error ?? "";
  }
}

export async function sendDiscordNotification(
  webhookUrl: string,
  event: DiscordNotifyEvent,
  data: {
    sourceName: string;
    sourceUrl: string;
    branch: string;
    commitSha?: string | null;
    previousSha?: string | null;
    stlCount?: number;
    error?: string;
  },
): Promise<void> {
  const logger = getLogger();
  const meta = EVENT_META[event];
  const title = `${meta.emoji} ${meta.titleTemplate.replace("{sourceName}", data.sourceName)}`;
  const description = buildDescription(event, data);
  const timestamp = new Date().toISOString();

  const payload = {
    embeds: [
      {
        color: meta.color,
        author: { name: "Print Partner" },
        title,
        description,
        url: data.sourceUrl || undefined,
        footer: { text: `Print Partner · ${new Date().toLocaleString()}` },
        timestamp,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await safeOutboundFetch(
        webhookUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
        { allowPrivate: false },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.log(
          "warn",
          `[discord-notify] Webhook returned ${response.status}: ${text.slice(0, 200)}`,
          { event, sourceName: data.sourceName },
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    // Fail silently — Discord is best-effort
    logger.log(
      "warn",
      `[discord-notify] Failed to send notification: ${err instanceof Error ? err.message : String(err)}`,
      { event, sourceName: data.sourceName },
    );
  }
}

export type FarmDigestData = {
  platesOvernight: number;
  windowHours: number;
  printers: Array<{ name: string; state: string; active_job?: string | null }>;
  activePlans: Array<{ plan_name: string; remaining_units: number }>;
};

function buildDigestDescription(d: FarmDigestData): string {
  const lines: string[] = [];
  const windowLabel = d.windowHours === 8 ? "overnight" : `last ${d.windowHours}h`;
  lines.push(`**${d.platesOvernight}** plate(s) sent to printers ${windowLabel}.`);

  if (d.printers.length > 0) {
    lines.push("");
    lines.push("**Printers:**");
    for (const p of d.printers) {
      const stateEmoji =
        p.state === "printing" || p.state === "paused"
          ? "🖨️"
          : p.state === "idle" || p.state === "complete"
          ? "✅"
          : "⚫";
      const jobNote = p.active_job ? ` — \`${p.active_job}\`` : "";
      lines.push(`${stateEmoji} **${p.name}** ${p.state}${jobNote}`);
    }
  }

  if (d.activePlans.length > 0) {
    lines.push("");
    lines.push("**Plans:**");
    for (const plan of d.activePlans.slice(0, 5)) {
      lines.push(`• ${plan.plan_name}: **${plan.remaining_units}** units remaining`);
    }
    if (d.activePlans.length > 5) {
      lines.push(`_…and ${d.activePlans.length - 5} more_`);
    }
  }

  return lines.join("\n");
}

export async function sendFarmDigest(webhookUrl: string, data: FarmDigestData): Promise<void> {
  const logger = getLogger();
  const meta = EVENT_META["farm.digest"];
  const description = buildDigestDescription(data);
  const timestamp = new Date().toISOString();

  const payload = {
    embeds: [
      {
        color: meta.color,
        author: { name: "Print Partner" },
        title: `${meta.emoji} ${meta.titleTemplate}`,
        description,
        footer: { text: `Print Partner · ${new Date().toLocaleString()}` },
        timestamp,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await safeOutboundFetch(
        webhookUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
        { allowPrivate: false },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.log(
          "warn",
          `[discord-notify] Farm digest webhook returned ${response.status}: ${text.slice(0, 200)}`,
          {},
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logger.log(
      "warn",
      `[discord-notify] Failed to send farm digest: ${err instanceof Error ? err.message : String(err)}`,
      {},
    );
  }
}
