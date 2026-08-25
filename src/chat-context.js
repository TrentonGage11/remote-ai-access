export function middleTruncate(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  const marker = `\n\n[... ${text.length - maxChars} characters compacted ...]\n\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(remaining * 0.55);
  const tail = Math.max(0, remaining - head);
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(-tail) : ""}`;
}

export function sanitizeChatMessages(body) {
  const rawMessages = Array.isArray(body?.messages)
    ? body.messages
    : [{ role: "user", content: body?.message }];

  const messages = [];
  for (const item of rawMessages) {
    const role = item?.role;
    const content = typeof item?.content === "string" ? item.content.trim() : "";
    if ((role === "user" || role === "assistant") && content) {
      messages.push({ role, content });
    }
  }
  return messages;
}

export function validateProviderMessages(messages, limits) {
  const messageMaxChars = Number(limits?.messageMaxChars || 0);
  const contextMaxChars = Number(limits?.contextMaxChars || 0);
  if (!Array.isArray(messages) || messages.length === 0 || messageMaxChars < 1 || contextMaxChars < 1) {
    return false;
  }

  let totalChars = 0;
  for (const item of messages) {
    const role = item?.role;
    const content = typeof item?.content === "string" ? item.content.trim() : "";
    if ((role !== "user" && role !== "assistant") || !content) {
      return false;
    }
    totalChars += content.length;
    if (content.length > messageMaxChars || totalChars > contextMaxChars) {
      return false;
    }
  }
  return true;
}

function normalizePersistentContext(body, limits) {
  const content = typeof body?.persistentContext === "string" ? body.persistentContext.trim() : "";
  if (!content) {
    return "";
  }
  const reserveForChat = Math.min(1000, Math.max(1, limits.contextMaxChars - 1));
  const maxChars = Math.max(1, Math.min(limits.messageMaxChars, limits.contextMaxChars - reserveForChat));
  return middleTruncate(content, maxChars);
}

function summarizeCompactedMessages(messages, maxChars) {
  const lines = [
    "Conversation context was automatically compacted to fit provider message limits.",
    "Full original chat history remains saved in the browser archive/history; this summary is only provider context.",
    ""
  ];

  for (const [index, message] of messages.entries()) {
    const label = message.role === "user" ? "User" : "Assistant";
    const snippet = middleTruncate(message.content.replace(/\s+/g, " ").trim(), 700);
    lines.push(`${index + 1}. ${label}: ${snippet}`);
    const joined = lines.join("\n");
    if (joined.length >= maxChars) {
      return middleTruncate(joined, maxChars);
    }
  }

  return middleTruncate(lines.join("\n"), maxChars);
}

function compactMessages(body, original, persistentContext, limits) {
  const prefix = persistentContext ? [{ role: "user", content: persistentContext }] : [];
  const chatBudget = limits.contextMaxChars - persistentContext.length;
  if (chatBudget < 1 || original.length === 0) {
    return null;
  }

  const recent = [];
  let recentChars = 0;
  for (let index = original.length - 1; index >= 0; index -= 1) {
    const item = original[index];
    const available = chatBudget - recentChars;
    if (available < 1) {
      break;
    }
    let content = middleTruncate(item.content, limits.messageMaxChars);
    if (recent.length === 0 && content.length > available) {
      content = middleTruncate(content, available);
    }
    if (!content || recentChars + content.length > chatBudget) {
      break;
    }
    recent.unshift({ role: item.role, content });
    recentChars += content.length;
  }

  if (recent.length === 0) {
    return null;
  }

  const compactedCount = Math.max(0, original.length - recent.length);
  const compacted = [...prefix];
  const summaryBudget = Math.min(
    limits.summaryMaxChars,
    limits.messageMaxChars,
    Math.max(0, chatBudget - recentChars)
  );
  if (compactedCount > 0 && summaryBudget >= 200) {
    compacted.push({
      role: "assistant",
      content: summarizeCompactedMessages(original.slice(0, compactedCount), summaryBudget)
    });
  }
  compacted.push(...recent);

  if (!validateProviderMessages(compacted, limits)) {
    return null;
  }

  return {
    messages: compacted,
    compaction: {
      applied: true,
      originalMessageCount: original.length,
      sentMessageCount: recent.length + (compacted.length - prefix.length - recent.length),
      compactedMessageCount: compactedCount,
      originalChars: original.reduce((total, message) => total + message.content.length, 0),
      sentChars: compacted.reduce((total, message) => total + message.content.length, 0),
      persistentContextApplied: Boolean(persistentContext)
    }
  };
}

export function resolveProviderMessageContext(body, limitsInput) {
  const limits = {
    messageMaxChars: Math.max(1, Number(limitsInput?.messageMaxChars || 0)),
    contextMaxChars: Math.max(1, Number(limitsInput?.contextMaxChars || 0)),
    summaryMaxChars: Math.max(1, Number(limitsInput?.summaryMaxChars || 0))
  };
  const original = sanitizeChatMessages(body);
  if (original.length === 0) {
    return null;
  }

  const persistentContext = normalizePersistentContext(body, limits);
  const messages = persistentContext
    ? [{ role: "user", content: persistentContext }, ...original]
    : original;
  if (validateProviderMessages(messages, limits)) {
    return {
      messages,
      compaction: {
        applied: false,
        persistentContextApplied: Boolean(persistentContext)
      }
    };
  }

  if (body?.autoCompact !== true) {
    return null;
  }
  return compactMessages(body, original, persistentContext, limits);
}
