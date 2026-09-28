import { stringify as stringifyYaml } from "yaml";
import type { MessageContext } from "./backendMessageContext";
import type { TemplatePreset } from "../shared/templatePresets";
import type { TrackerConfig } from "../shared/trackerConfig";
import { buildTemplateExampleData, formatTrackerPayload as formatPayloadWithTag, replaceTrackerBlock as replaceBlockWithTag } from "./trackerCommandText";
import { parseTrackerPayload } from "./trackerPayload";

type CommandResultPayload = {
  command: string;
  ok: boolean;
  message: string;
  block?: string;
  mode?: "chat_mutation" | "fallback";
};

type CommandMessage = { id: string; role: "system" | "user" | "assistant"; content: string };

export function createCommandEngine(deps: {
  readConfig: () => Pick<TrackerConfig, "trackerFormat" | "codeBlockIdentifier" | "trackerTagName">;
  readLastSimStats: () => string;
  writeLastSimStats: (value: string) => void;
  getActivePreset: () => TemplatePreset;
  extractTrackerPayloadFromMessage: (content: string) => string | null;
  hasChatMutationPermission: () => boolean;
  getMessages: (chatId: string) => Promise<CommandMessage[]>;
  updateMessage: (chatId: string, messageId: string, change: { content: string }) => Promise<unknown>;
  pushMacroValues: () => void;
  trackEvent: (
    eventName: string,
    payload?: Record<string, unknown>,
    options?: { level?: "debug" | "info" | "warn" | "error"; chatId?: string },
  ) => Promise<void>;
}) {
  function formatTrackerPayload(data: Record<string, unknown>, format: "json" | "yaml", identifier: string): string {
    return formatPayloadWithTag(data, format, identifier, deps.readConfig().trackerTagName);
  }

  function makeStarterTrackerBlock(): string {
    const config = deps.readConfig();
    return formatTrackerPayload(buildTemplateExampleData(deps.getActivePreset()), config.trackerFormat, config.codeBlockIdentifier);
  }

  function replaceTrackerBlock(content: string, identifier: string, replacementBlock: string): string {
    return replaceBlockWithTag(content, identifier, replacementBlock, deps.readConfig().trackerTagName);
  }

  function buildCommandResponse(payload: CommandResultPayload): { type: string; payload: CommandResultPayload } {
    return { type: "command_result", payload };
  }

  async function mutateChatForCommand(
    command: "/sst-add" | "/sst-convert" | "/sst-regen",
    arg1: string | undefined,
    ctx: MessageContext,
  ): Promise<CommandResultPayload | null> {
    if (!deps.hasChatMutationPermission() || !ctx.chatId) return null;

    let messages: CommandMessage[] = [];
    try {
      messages = await deps.getMessages(ctx.chatId);
    } catch {
      return null;
    }

    let latestTrackerMessage: CommandMessage | null = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (deps.extractTrackerPayloadFromMessage(msg.content)) {
        latestTrackerMessage = msg;
        break;
      }
    }

    if (command === "/sst-add") {
      const target = messages.findLast((msg) => msg.role === "assistant") || null;
      if (!target) {
        return {
          command: "sst-add",
          ok: false,
          message: "No assistant message found to append tracker tag.",
          mode: "chat_mutation",
        };
      }
      if (deps.extractTrackerPayloadFromMessage(target.content)) {
        return {
          command: "sst-add",
          ok: false,
          message: "Latest assistant message already contains a tracker tag.",
          mode: "chat_mutation",
        };
      }
      const block = makeStarterTrackerBlock();
      const updatedContent = `${target.content.trimEnd()}\n\n${block}`;
      await deps.updateMessage(ctx.chatId, target.id, { content: updatedContent });
      await deps.trackEvent("sst.command.add", { mode: "chat_mutation" }, { chatId: ctx.chatId });
      return {
        command: "sst-add",
        ok: true,
        message: "Added starter tracker tag to latest assistant message.",
        block,
        mode: "chat_mutation",
      };
    }

    if (!latestTrackerMessage) {
      return {
        command: command.replace("/", ""),
        ok: false,
        message: "No tracker tag found in current chat.",
        mode: "chat_mutation",
      };
    }

    const raw = deps.extractTrackerPayloadFromMessage(latestTrackerMessage.content);
    if (!raw) {
      return {
        command: command.replace("/", ""),
        ok: false,
        message: "Latest tracker tag could not be read.",
        mode: "chat_mutation",
      };
    }

    const parsed = parseTrackerPayload(raw);
    if (!parsed) {
      return {
        command: command.replace("/", ""),
        ok: false,
        message: "Latest tracker tag is invalid and cannot be rewritten.",
        mode: "chat_mutation",
      };
    }

    const targetFormat = command === "/sst-convert"
      ? arg1 === "yaml"
        ? "yaml"
        : arg1 === "json"
          ? "json"
          : deps.readConfig().trackerFormat
      : deps.readConfig().trackerFormat;

    const replacement = formatTrackerPayload(parsed, targetFormat, deps.readConfig().codeBlockIdentifier);
    const updatedContent = replaceTrackerBlock(latestTrackerMessage.content, deps.readConfig().codeBlockIdentifier, replacement);
    await deps.updateMessage(ctx.chatId, latestTrackerMessage.id, { content: updatedContent });

    deps.writeLastSimStats(targetFormat === "yaml" ? stringifyYaml(parsed) : JSON.stringify(parsed, null, 2));
    deps.pushMacroValues();
    await deps.trackEvent(
      command === "/sst-convert" ? "sst.command.convert" : "sst.command.regen",
      { mode: "chat_mutation", format: targetFormat },
      { chatId: ctx.chatId },
    );

    return {
      command: command.replace("/", ""),
      ok: true,
      message:
        command === "/sst-convert"
          ? `Converted latest tracker to ${targetFormat.toUpperCase()} and updated chat message.`
          : "Rebuilt latest tracker tag in preferred format and updated chat message.",
      block: replacement,
      mode: "chat_mutation",
    };
  }

  async function handleSlashCommand(content: string, ctx: MessageContext): Promise<{ type: string; payload: CommandResultPayload } | null> {
    const trimmed = content.trim();
    if (!trimmed.startsWith("/sst-")) return null;

    const [commandRaw, arg1] = trimmed.split(/\s+/);
    const command = commandRaw as "/sst-add" | "/sst-convert" | "/sst-regen";

    if (!["/sst-add", "/sst-convert", "/sst-regen"].includes(command)) {
      return buildCommandResponse({
        command: commandRaw.replace("/", ""),
        ok: false,
        message: "Unknown SST command. Supported: /sst-add, /sst-convert, /sst-regen",
        mode: "fallback",
      });
    }

    const chatResult = await mutateChatForCommand(command, arg1, ctx);
    if (chatResult) {
      return buildCommandResponse(chatResult);
    }

    if (command === "/sst-convert") {
      const target = arg1 === "yaml" ? "yaml" : arg1 === "json" ? "json" : deps.readConfig().trackerFormat;
      if (!deps.readLastSimStats() || deps.readLastSimStats() === "{}") {
        return buildCommandResponse({
          command: "sst-convert",
          ok: false,
          message: "No tracker tag found yet.",
          mode: "fallback",
        });
      }
      const parsed = parseTrackerPayload(deps.readLastSimStats());
      if (!parsed) {
        return buildCommandResponse({
          command: "sst-convert",
          ok: false,
          message: "Latest tracker tag is invalid and cannot be converted.",
          mode: "fallback",
        });
      }
      const block = formatTrackerPayload(parsed, target, deps.readConfig().codeBlockIdentifier);
      deps.writeLastSimStats(target === "yaml" ? stringifyYaml(parsed) : JSON.stringify(parsed, null, 2));
      deps.pushMacroValues();
      await deps.trackEvent("sst.command.convert", { mode: "fallback", format: target }, ctx.chatId ? { chatId: ctx.chatId } : undefined);
      return buildCommandResponse({
        command: "sst-convert",
        ok: true,
        message: `Converted latest tracker to ${target.toUpperCase()}.`,
        block,
        mode: "fallback",
      });
    }

    if (command === "/sst-add") {
      const block = makeStarterTrackerBlock();
      await deps.trackEvent("sst.command.add", { mode: "fallback" }, ctx.chatId ? { chatId: ctx.chatId } : undefined);
      return buildCommandResponse({
        command: "sst-add",
        ok: true,
        message: "Generated a starter tracker tag.",
        block,
        mode: "fallback",
      });
    }

    if (!deps.readLastSimStats() || deps.readLastSimStats() === "{}") {
      return buildCommandResponse({
        command: "sst-regen",
        ok: false,
        message: "No tracker tag to regenerate yet. Use /sst-add first.",
        mode: "fallback",
      });
    }
    const parsed = parseTrackerPayload(deps.readLastSimStats());
    if (!parsed) {
      return buildCommandResponse({
        command: "sst-regen",
        ok: false,
        message: "Latest tracker is invalid and cannot be regenerated.",
        mode: "fallback",
      });
    }
    const block = formatTrackerPayload(parsed, deps.readConfig().trackerFormat, deps.readConfig().codeBlockIdentifier);
    await deps.trackEvent(
      "sst.command.regen",
      { mode: "fallback", format: deps.readConfig().trackerFormat },
      ctx.chatId ? { chatId: ctx.chatId } : undefined,
    );
    return buildCommandResponse({
      command: "sst-regen",
      ok: true,
      message: "Rebuilt latest tracker tag in preferred format.",
      block,
      mode: "fallback",
    });
  }

  return { handleSlashCommand };
}
