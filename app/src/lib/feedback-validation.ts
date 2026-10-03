import type { FeedbackCategory, FeedbackInput, FeedbackStatus } from "./types.js";

export const FEEDBACK_CATEGORIES = ["general", "bug", "idea"] as const satisfies readonly FeedbackCategory[];
export const FEEDBACK_STATUSES = ["new", "reviewed", "resolved"] as const satisfies readonly FeedbackStatus[];
export const MAX_FEEDBACK_MESSAGE_LENGTH = 2_000;

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export function parseFeedbackInput(body: unknown): FeedbackInput | { error: string } {
  const values =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const message = typeof values.message === "string" ? values.message.trim() : "";
  if (!message) {
    return { error: "Feedback is required." };
  }
  if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    return { error: `Feedback must be ${MAX_FEEDBACK_MESSAGE_LENGTH.toLocaleString()} characters or fewer.` };
  }

  const category = values.category;
  if (typeof category !== "string" || !(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
    return { error: "Choose a valid feedback type." };
  }

  return { message, category: category as FeedbackCategory };
}
