/**
 * Cleans a browser tab title into a conversation title.
 * Returns null when nothing meaningful is left (e.g. the tab is just "ChatGPT").
 */
export function cleanTitle(raw: string, brandNames: readonly string[]): string | null {
  let title = raw.trim();
  for (const brand of brandNames) {
    const suffix = new RegExp(`\\s*[-|–—]\\s*${brand}\\s*$`, 'i');
    title = title.replace(suffix, '').trim();
  }
  if (!title) return null;
  if (brandNames.some((b) => b.toLowerCase() === title.toLowerCase())) return null;
  return title;
}
