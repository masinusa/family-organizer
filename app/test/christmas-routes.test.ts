import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { FEATURES } from "../src/lib/features.js";
import { PersonaDirectory } from "../src/lib/persona.js";
import { secretSantaRepo } from "../src/lib/secret-santa-repo.js";
import type { PersonDoc, SecretSantaDoc, UserDoc } from "../src/lib/types.js";
import { christmasRouter } from "../src/routes/christmas.js";

const at = new Date(2026, 9, 1);
function person(id: string, name: string, circle: PersonDoc["circle"] = "family"): PersonDoc {
  return {
    id, name, circle, email: `${id}@example.com`, blurb: null, birthMonth: null, birthDay: null,
    birthYear: null, color: null, parentIds: [], connectionIds: [], createdAt: at, updatedAt: at,
  };
}
function user(id: string, role: UserDoc["role"]): UserDoc {
  return { email: `${id}@example.com`, role, optIns: [], createdAt: at, updatedAt: at };
}

// Admin runs it and takes part; Rae is a friend; Mo is family but not in it.
const directory = new PersonaDirectory(
  [person("ada", "Ada Admin"), person("bea", "Bea Bloom"), person("cal", "Cal Crane"), person("rae", "Rae Friend", "friend"), person("mo", "Mo Outside")],
  [user("ada", "admin"), user("bea", "member"), user("cal", "member"), user("rae", "friend"), user("mo", "member")],
);

const exchange: SecretSantaDoc = {
  year: 2026, budget: 40, exchangeDate: "2026-12-24",
  participantIds: ["ada", "bea", "cal", "rae"],
  assignments: { ada: "bea", bea: "cal", cal: "rae", rae: "ada" },
  drawnAt: at, createdBy: "ada@example.com", createdAt: at, updatedAt: at,
};

async function get(as: string, path: string): Promise<{ status: number; html: string }> {
  const app = express();
  app.use((req, _res, next) => {
    const account = directory.byId(as)!;
    req.user = { email: account.email! };
    req.appUser = user(as, account.role!);
    req.personas = directory;
    req.persona = account;
    req.features = FEATURES;
    next();
  });
  app.use(christmasRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, html: await res.text() };
  } finally {
    server.close();
  }
}

function stubRepo(t: { mock: { method: Function } }) {
  t.mock.method(secretSantaRepo, "getExchange", async (year: number) => (year === 2026 ? exchange : null));
  t.mock.method(secretSantaRepo, "listExchanges", async () => [exchange]);
}

/** Names of people the viewer is *not* buying for, as they'd appear in the reveal. */
function revealName(html: string): string | null {
  return html.match(/<strong class="santa-name">([^<]*)<\/strong>/)?.[1] ?? null;
}

test("a participant sees who they're buying for and no other pair", async (t) => {
  stubRepo(t);
  const { status, html } = await get("bea", "/christmas/secret-santa/2026");
  assert.equal(status, 200);
  assert.equal(revealName(html), "Cal Crane");
  assert.doesNotMatch(html, /class="santa-table"|name="to:|Show all assignments/);
});

test("a friend taking part sees their own pair", async (t) => {
  stubRepo(t);
  const { html } = await get("rae", "/christmas/secret-santa/2026");
  assert.equal(revealName(html), "Ada Admin");
});

test("asking for the full list as a non-admin shows nothing more", async (t) => {
  stubRepo(t);
  const { html } = await get("bea", "/christmas/secret-santa/2026?all=1");
  assert.doesNotMatch(html, /class="santa-table"|name="to:/);
});

test("an admin sees only their own pair until they open the full list", async (t) => {
  stubRepo(t);
  const closed = await get("ada", "/christmas/secret-santa/2026");
  assert.equal(revealName(closed.html), "Bea Bloom");
  assert.doesNotMatch(closed.html, /<select name="to:/);
  assert.match(closed.html, /Show all assignments/);

  const open = await get("ada", "/christmas/secret-santa/2026?all=1");
  assert.match(open.html, /<select name="to:cal"/);
  assert.match(open.html, /<option value="rae" selected>/);
});

test("someone not taking part gets a 404, not a hint that it exists", async (t) => {
  stubRepo(t);
  assert.equal((await get("mo", "/christmas/secret-santa/2026")).status, 404);
  assert.equal((await get("bea", "/christmas/secret-santa/2025")).status, 404);
  assert.equal((await get("bea", "/christmas/secret-santa/abcd")).status, 404);
});

test("the hub lists only exchanges the viewer is in, with their own pair", async (t) => {
  stubRepo(t);
  const bea = await get("bea", "/christmas");
  assert.match(bea.html, /Secret Santa 2026/);
  assert.match(bea.html, /Cal Crane/);
  assert.doesNotMatch(bea.html, /Rae Friend|Ada Admin<\/span>/);
  const mo = await get("mo", "/christmas");
  assert.doesNotMatch(mo.html, /href="\/christmas\/secret-santa\/2026"/);
});
