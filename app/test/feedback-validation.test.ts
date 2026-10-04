import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FEEDBACK_MESSAGE_LENGTH,
  parseFeedbackInput,
} from "../src/lib/feedback-validation.js";

test("parseFeedbackInput accepts a trimmed message and valid category", () => {
  assert.deepEqual(parseFeedbackInput({ message: "  Add reminders  ", category: "idea" }), {
    message: "Add reminders",
    category: "idea",
  });
});

test("parseFeedbackInput rejects a missing message", () => {
  assert.deepEqual(parseFeedbackInput({ category: "general" }), { error: "Feedback is required." });
});

test("parseFeedbackInput rejects a malformed request body", () => {
  assert.deepEqual(parseFeedbackInput(null), { error: "Feedback is required." });
});

test("parseFeedbackInput rejects an oversized message", () => {
  assert.deepEqual(
    parseFeedbackInput({ message: "x".repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1), category: "general" }),
    { error: "Feedback must be 2,000 characters or fewer." },
  );
});

test("parseFeedbackInput rejects an unrecognized category", () => {
  assert.deepEqual(parseFeedbackInput({ message: "Something happened", category: "other" }), {
    error: "Choose a valid feedback type.",
  });
});
