import type { ExtractedConversation } from '../shared/conversation';

export function summarize(c: ExtractedConversation) {
  const user = c.messages.filter((m) => m.role === 'user').length;
  const chars = c.messages.reduce((n, m) => n + m.content.length, 0);
  const fences = c.messages.reduce((n, m) => n + (m.content.match(/^\s*`{3,}/gm)?.length ?? 0), 0);
  return { user, assistant: c.messages.length - user, chars, codeBlocks: Math.floor(fences / 2) };
}

export function fileName(c: ExtractedConversation): string {
  const slug = (c.title ?? 'conversation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `ai-handoff-${c.provider}-${slug || 'conversation'}-${c.extractedAt.slice(0, 10)}.json`;
}
