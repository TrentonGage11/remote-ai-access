import { middleTruncate } from "./chat-context.js";

function messageChars(message) {
  return JSON.stringify(message || {}).length;
}

export function serializeBoundedToolOutput(output, maxChars = 4000) {
  return middleTruncate(JSON.stringify(output), Math.max(200, Number(maxChars || 0)));
}

export function buildBoundedAgentConversation(conversation, prefixCount, maxChars = 64000) {
  const messages = Array.isArray(conversation) ? conversation : [];
  const protectedCount = Math.max(0, Math.min(messages.length, Number(prefixCount || 0)));
  const prefix = messages.slice(0, protectedCount);
  const rounds = [];

  for (let index = protectedCount; index < messages.length;) {
    const start = index;
    index += 1;
    if (Array.isArray(messages[start]?.tool_calls)) {
      while (index < messages.length && messages[index]?.role === "tool") index += 1;
    }
    rounds.push(messages.slice(start, index));
  }

  const limit = Math.max(prefix.reduce((total, message) => total + messageChars(message), 0), Number(maxChars || 0));
  const kept = [];
  let chars = prefix.reduce((total, message) => total + messageChars(message), 0);
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const roundChars = rounds[index].reduce((total, message) => total + messageChars(message), 0);
    if (chars + roundChars > limit) break;
    kept.unshift(...rounds[index]);
    chars += roundChars;
  }

  if (kept.length === messages.length - protectedCount) return messages;
  return [
    ...prefix,
    { role: "system", content: "Earlier tool exchanges were compacted to stay within provider input-rate limits. Re-read files or rerun tools if older details are needed." },
    ...kept
  ];
}