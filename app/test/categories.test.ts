import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CATEGORIES,
  FALLBACK_CATEGORY,
  contrastInk,
  isValidHexColor,
  mergeCategories,
  normalizeHexColor,
  resolveCategory,
  slugifyCategoryName,
  validateNewCategory,
} from "../src/lib/categories.js";
import type { CategoryDoc } from "../src/lib/types.js";

const custom = (id: string, name: string, color = "#123456"): CategoryDoc => ({
  id,
  name,
  color,
  builtIn: false,
});

test("isValidHexColor accepts only canonical six-digit hex", () => {
  assert.equal(isValidHexColor("#c98a2c"), true);
  assert.equal(isValidHexColor("#C98A2C"), true);
  assert.equal(isValidHexColor("c98a2c"), false);
  assert.equal(isValidHexColor("#abc"), false);
  assert.equal(isValidHexColor("red"), false);
  assert.equal(isValidHexColor("#c98a2c; background: url(x)"), false);
});

test("normalizeHexColor takes what someone would actually type", () => {
  assert.equal(normalizeHexColor("#C98A2C"), "#c98a2c");
  assert.equal(normalizeHexColor("c98a2c"), "#c98a2c");
  assert.equal(normalizeHexColor("  #ABC "), "#aabbcc");
  assert.equal(normalizeHexColor("abc"), "#aabbcc");
  assert.equal(normalizeHexColor("rebeccapurple"), null);
  assert.equal(normalizeHexColor(""), null);
  assert.equal(normalizeHexColor("#12345"), null);
});

test("slugifyCategoryName makes a safe document id", () => {
  assert.equal(slugifyCategoryName("Family Event"), "family-event");
  assert.equal(slugifyCategoryName("  Nana's 80th!  "), "nana-s-80th");
  assert.equal(slugifyCategoryName("***"), "");
});

test("validateNewCategory rejects blanks, collisions and non-colours", () => {
  const existing = mergeCategories([custom("reunion", "Reunion")]);

  assert.deepEqual(validateNewCategory("  ", "#c98a2c", existing), {
    error: "A category name is required.",
  });
  assert.deepEqual(validateNewCategory("***", "#c98a2c", existing), {
    error: "A category name needs at least one letter or number.",
  });
  // Collides with a built-in, which mergeCategories includes.
  assert.ok("error" in validateNewCategory("Holiday", "#c98a2c", existing));
  // ...and with an existing custom one, case/spacing insensitively.
  assert.ok("error" in validateNewCategory("  reunion  ", "#c98a2c", existing));
  assert.deepEqual(validateNewCategory("School", "not-a-colour", existing), {
    error: "Pick a colour, or type a hex value like #c98a2c.",
  });
  assert.ok("error" in validateNewCategory("x".repeat(41), "#c98a2c", existing));
});

test("validateNewCategory normalizes the name and colour it accepts", () => {
  assert.deepEqual(validateNewCategory("  Nana   visit ", "ABC", DEFAULT_CATEGORIES), {
    id: "nana-visit",
    name: "Nana visit",
    color: "#aabbcc",
  });
});

test("resolveCategory falls back for missing and deleted categories", () => {
  const categories = mergeCategories([custom("reunion", "Reunion")]);

  assert.equal(resolveCategory("reunion", categories).name, "Reunion");
  assert.equal(resolveCategory("holiday", categories).name, "Holiday");
  // An event pointing at a since-deleted category must still render.
  assert.deepEqual(resolveCategory("gone-away", categories), FALLBACK_CATEGORY);
  assert.deepEqual(resolveCategory(null, categories), FALLBACK_CATEGORY);
});

test("mergeCategories keeps built-ins first, then custom ones alphabetically", () => {
  const merged = mergeCategories([custom("zoo", "Zoo day"), custom("aunt", "Aunt Jo")]);

  assert.deepEqual(
    merged.slice(0, DEFAULT_CATEGORIES.length).map((c) => c.id),
    DEFAULT_CATEGORIES.map((c) => c.id),
  );
  assert.deepEqual(
    merged.slice(DEFAULT_CATEGORIES.length).map((c) => c.id),
    ["aunt", "zoo"],
  );
});

test("contrastInk picks readable text for light and dark backgrounds", () => {
  assert.equal(contrastInk("#ffffff"), "#26291f");
  assert.equal(contrastInk("#f7e7a1"), "#26291f");
  assert.equal(contrastInk("#2f5233"), "#ffffff");
  assert.equal(contrastInk("#000000"), "#ffffff");
  // Garbage in never produces a colour the caller would inline blindly.
  assert.equal(contrastInk("not-a-colour"), "#26291f");
});

test("every built-in category has a valid colour and unique id", () => {
  const ids = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
  assert.equal(ids.size, DEFAULT_CATEGORIES.length);
  DEFAULT_CATEGORIES.forEach((c) => {
    assert.equal(isValidHexColor(c.color), true, `${c.id} has colour ${c.color}`);
    assert.equal(slugifyCategoryName(c.name), c.id, `${c.id} slug matches its name`);
  });
});
