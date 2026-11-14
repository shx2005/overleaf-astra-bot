export const BOT_TRIGGER = "ageaf:bot:trigger";
export const BOT_REQUEST = "ageaf:bot:request";
export const BOT_RESPONSE = "ageaf:bot:response";
export type BotTrigger = {
  id: string;
  projectId: string;
  threadId?: string;
  prompt: string;
  scopeId?: string;
};
export function parseBotCommand(
  url: string,
  method: string,
  body: unknown,
  origin: string
) {
  const u = new URL(url, origin);
  if (u.origin !== origin || method.toUpperCase() !== "POST") return null;
  const match = u.pathname.match(
    /^\/project\/([a-f0-9]{24})\/(?:thread\/([a-f0-9]+)\/)?messages\/?$/i
  );
  if (!match || typeof body !== "string") return null;
  let content: unknown;
  try {
    content = JSON.parse(body).content;
  } catch {
    return null;
  }
  if (typeof content !== "string") return null;
  const mention = content.match(/^\s*@bot(?:\s+|[，,:：]\s*)([\s\S]+)$/i);
  if (!mention || !mention[1].trim()) return null;
  return {
    projectId: match[1],
    threadId: match[2],
    prompt: mention[1].trim(),
    content,
  };
}
