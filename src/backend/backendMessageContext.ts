export type MessageContext = {
  chatId: string | null;
  messageId: string | null;
  content: string | null;
};

export function readMessageContext(payload: unknown): MessageContext {
  if (!payload || typeof payload !== "object") {
    return { chatId: null, messageId: null, content: null };
  }
  const obj = payload as Record<string, unknown>;
  const nestedMessage = (obj.message && typeof obj.message === "object" ? obj.message : {}) as Record<string, unknown>;
  const nestedChat = (obj.chat && typeof obj.chat === "object" ? obj.chat : {}) as Record<string, unknown>;

  const chatIdCandidates = [obj.chatId, obj.chat_id, nestedMessage.chatId, nestedMessage.chat_id, nestedChat.id, obj.id];
  const messageIdCandidates = [obj.messageId, obj.message_id, nestedMessage.id, nestedMessage.messageId, obj.id];

  const content =
    (typeof nestedMessage.content === "string" ? nestedMessage.content : null) ||
    (typeof obj.content === "string" ? obj.content : null);

  const chatId = chatIdCandidates.find((value) => typeof value === "string" && value.trim().length > 0) as
    | string
    | undefined;
  const messageId = messageIdCandidates.find((value) => typeof value === "string" && value.trim().length > 0) as
    | string
    | undefined;

  return {
    chatId: chatId || null,
    messageId: messageId || null,
    content,
  };
}
