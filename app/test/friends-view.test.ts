import assert from "node:assert/strict";
import { test } from "node:test";
import { featureByKey, FEATURES } from "../src/lib/features.js";
import { PersonaDirectory } from "../src/lib/persona.js";
import { render } from "../src/lib/render.js";
import type { PersonDoc, UserDoc } from "../src/lib/types.js";

const at = new Date(2026, 9, 1);
const person = (id: string, name: string, email: string, circle: PersonDoc["circle"]): PersonDoc => ({
  id, name, circle, email, blurb: null, birthMonth: null, birthDay: null, birthYear: null,
  color: null, parentIds: [], connectionIds: [], createdAt: at, updatedAt: at,
});
const user = (email: string, role: UserDoc["role"], optIns: UserDoc["optIns"] = []): UserDoc => ({
  email, role, optIns, createdAt: at, updatedAt: at,
});

const directory = new PersonaDirectory(
  [person("p1", "Ada", "ada@example.com", "family"), person("f1", "Rae", "rae@example.com", "friend")],
  [user("ada@example.com", "admin"), user("rae@example.com", "friend", ["vault"])],
);

function chromeFor(email: string, nav: typeof FEATURES) {
  return {
    email,
    viewer: directory.forEmail(email),
    impersonatorPersona: null,
    isAdmin: false,
    nav: nav.filter((f) => f.nav),
    canFeedback: nav.some((f) => f.key === "feedback"),
    active: null,
    impersonator: null,
    canImpersonate: false,
    path: "/",
  };
}

test("the friends page renders each friend with their switches", () => {
  const rae = directory.byId("f1")!;
  const html = render("friends", {
    ...chromeFor("ada@example.com", FEATURES),
    friends: [{ persona: rae, optIns: ["vault"], reach: ["Vault"] }],
    features: FEATURES,
    error: null,
    warning: null,
  });
  assert.match(html, /action="\/friends\/f1\/access"/);
  assert.match(html, /value="vault" checked/);
  assert.match(html, /value="calendar" (?!checked)/);
});

test("a friend's nav shows only what they can open, and no feedback button", () => {
  const html = render("forbidden", { ...chromeFor("rae@example.com", [featureByKey("vault")]), message: "x" });
  assert.match(html, /href="\/subscriptions"/);
  assert.doesNotMatch(html, /href="\/family"/);
  assert.doesNotMatch(html, /class="feedback-fab"/);
  // A friend has no card on the tree, so their own chip isn't a link to one.
  assert.doesNotMatch(html, /href="\/family\/f1"/);
});

test("family see the full nav and the feedback button", () => {
  const html = render("forbidden", { ...chromeFor("ada@example.com", FEATURES), message: "x" });
  for (const href of ["/", "/family", "/subscriptions"]) assert.match(html, new RegExp(`href="${href}"`));
  assert.match(html, /class="feedback-fab"/);
});
