/**
 * Secret Santa wish lists, edited as one idea per line so the form needs
 * no JavaScript and reads the way people already write lists. A link
 * pasted anywhere in a line becomes that idea's link; the rest of the line
 * is the idea. Pure, so the round trip is testable.
 */
import { parseLink } from "./event-input.js";
import type { WishItem } from "./types.js";

export const MAX_ITEMS = 30;
export const MAX_TEXT = 200;

/** Case-insensitive, like the mailbox linkifier: `HTTP://` is still a link. */
const URL_TOKEN = /\bhttps?:\/\/\S+/i;

/**
 * "See https://x.example/a." links to /a, not /a. — sentence punctuation
 * goes back in the text. A closing bracket counts only if the URL opened
 * one (same rule as toBodyParts in lib/mailbox.ts).
 */
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1]!;
    if (".,:;!?".includes(ch)) end -= 1;
    else if (ch === ")" && !url.slice(0, end - 1).includes("(")) end -= 1;
    else break;
  }
  return url.slice(0, end);
}

export function parseWishlist(raw: unknown): WishItem[] | { error: string } {
  const lines = (typeof raw === "string" ? raw : "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > MAX_ITEMS) return { error: `A wish list holds up to ${MAX_ITEMS} ideas.` };

  const items: WishItem[] = [];
  for (const line of lines) {
    const match = line.match(URL_TOKEN);
    let link: string | null = null;
    let text = line;
    if (match) {
      const url = trimTrailing(match[0]);
      const parsed = parseLink(url);
      if ("error" in parsed) return { error: `"${url}": ${parsed.error}` };
      link = parsed.link;
      // What's left once the link is lifted out, minus the dash or colon
      // people tend to put between an idea and its link.
      text = (line.slice(0, match.index) + line.slice(match.index! + url.length))
        .replace(/\s+/g, " ")
        .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "");
    }
    if (text.length > MAX_TEXT) return { error: `Keep each idea to ${MAX_TEXT} characters.` };
    items.push({ text, link });
  }
  return items;
}

/** Back into the textarea, so saving without changes changes nothing. */
export function wishlistText(items: WishItem[]): string {
  return items.map((item) => [item.text, item.link].filter(Boolean).join(" ")).join("\n");
}

/** What a link-only idea is called, and the label beside one with text. */
export function linkHost(link: string): string {
  return new URL(link).host;
}
