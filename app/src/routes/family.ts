import { Router, type Request } from "express";
import { requireAdmin } from "../middleware/access-control.js";
import { chrome } from "../lib/chrome.js";
import { render } from "../lib/render.js";
import { normalizeEmail } from "../lib/email.js";
import { loadPersonaDirectory } from "../middleware/personas.js";
import {
  findDescendantIds,
  peopleRepo,
  TOO_MANY_PARENTS_ERROR,
  SELF_PARENT_ERROR,
  CYCLE_PARENT_ERROR,
  SELF_CONNECTION_ERROR,
  MISSING_PERSON_ERROR,
} from "../lib/people-repo.js";
import * as usersRepo from "../lib/users-repo.js";
import { CROSS_CIRCLE_ERROR, IAP_SYNC_WARNING, LAST_ADMIN_ERROR } from "../lib/users-repo.js";
import { canEditPersona, findDuplicateEmailOwner } from "../lib/family-link.js";
import {
  formatBirthday,
  isValidBirthYear,
  MIN_BIRTH_YEAR,
  MONTH_NAMES,
  PERSONA_COLORS,
  type Persona,
  type PersonaDirectory,
} from "../lib/persona.js";
import { buildTreeLayout } from "../lib/tree-layout.js";
import { secretSantaRepo } from "../lib/secret-santa-repo.js";
import { IN_EXCHANGE_ERROR } from "./friends.js";
import type { PersonaInput, UserRole } from "../lib/types.js";

export const familyRouter = Router();

/** Rejections the editor can show in place rather than as a 500. */
const RELATIONSHIP_ERRORS: string[] = [
  TOO_MANY_PARENTS_ERROR,
  SELF_PARENT_ERROR,
  CYCLE_PARENT_ERROR,
  SELF_CONNECTION_ERROR,
  MISSING_PERSON_ERROR,
];
/** The two shapes a relationship can take — see views/person.eta. */
const RELATIONSHIP_KINDS = ["parent", "connection"];
const VALID_ROLES: UserRole[] = ["admin", "member"];
const BLURB_MAX = 60;

/**
 * Every account belongs to somebody on the tree (lib/persona.ts throws
 * otherwise), so a person's email can't move or vanish while it still
 * grants access — the old address would be left as an account nobody owns.
 */
const HAS_ACCESS_EMAIL_ERROR = "Remove their access before changing their email.";
const HAS_ACCESS_DELETE_ERROR = "Remove their access before taking them off the tree.";

function viewer(req: Request): { email: string; role: UserRole } {
  return { email: req.appUser!.email, role: req.appUser!.role };
}

function personas(req: Request): PersonaDirectory {
  return req.personas!;
}

/**
 * The directory is loaded once at the start of the request, so a page
 * re-rendered in place after a write (an IAP warning) has to reload it to
 * show what was just saved.
 */
async function refreshPersonas(req: Request): Promise<void> {
  req.personas = await loadPersonaDirectory();
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePersona(body: Record<string, unknown>): PersonaInput | { error: string } {
  const name = str(body.name);
  if (!name) return { error: "A name is required." };

  const blurb = str(body.blurb).slice(0, BLURB_MAX);
  const month = Number(body.birthMonth);
  const day = Number(body.birthDay);
  const hasBirthday = Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31;
  const color = PERSONA_COLORS.some((c) => c.key === body.color) ? String(body.color) : null;

  // Year is validated on its own: someone may know only the day, or only
  // the year, and neither should discard the other.
  const rawYear = str(body.birthYear);
  const year = Number(rawYear);
  if (rawYear && !isValidBirthYear(year)) {
    return { error: `A birth year must be between ${MIN_BIRTH_YEAR} and ${new Date().getFullYear()}.` };
  }

  return {
    name,
    blurb: blurb || null,
    birthMonth: hasBirthday ? month : null,
    birthDay: hasBirthday ? day : null,
    birthYear: rawYear ? year : null,
    color,
  };
}

/**
 * The parent picker is a set of `parentIds` checkboxes, so this arrives as
 * an array or (when only one is ticked) a bare string. Blanks are dropped.
 */
function parsePersonIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string" && v !== "");
  return typeof raw === "string" && raw ? [raw] : [];
}

/** The account half of a persona, in the shape the templates show it. */
function accountOf(persona: Persona): { email: string; role: UserRole } | null {
  return persona.role ? { email: persona.email!, role: persona.role } : null;
}

async function renderTree(req: Request) {
  const directory = personas(req);
  const layout = buildTreeLayout(directory.family);

  // The template stays dumb — everything it needs is resolved here, the
  // same way calendar.eta just walks a pre-built grid.
  const cards = layout.cards.map((card) => {
    const persona = directory.byId(card.person.id)!;
    return {
      ...card,
      persona,
      birthday: formatBirthday(card.person.birthMonth, card.person.birthDay),
      account: accountOf(persona),
      hasAccount: persona.role !== null,
      isYou: req.persona!.personId === card.person.id,
    };
  });

  return render("family", { ...chrome(req, "family"), layout, cards });
}

/** Null when the person doesn't exist, so callers can 404. */
async function renderPerson(req: Request, id: string, notice: { error?: string; warning?: string } = {}) {
  const directory = personas(req);
  const person = directory.family.find((p) => p.id === id);
  if (!person) return null;
  const persona = directory.byId(id)!;
  const resolve = (ids: string[]) => ids.map((pid) => directory.byId(pid)).filter((p): p is Persona => !!p);

  // The pickers only offer links that would actually be accepted, so the
  // rules in people-repo are a backstop rather than the way you find out:
  // a descendant can't be a parent (that's the cycle), and an existing
  // link isn't worth offering twice.
  const others = directory.all().filter((p) => p.personId !== id);
  const descendants = findDescendantIds(id, directory.family);

  return render("person", {
    ...chrome(req, "family"),
    person,
    persona,
    parents: resolve(person.parentIds),
    connections: resolve(person.connectionIds),
    children: resolve(directory.family.filter((p) => p.parentIds.includes(id)).map((p) => p.id)),
    parentOptions: others.filter((p) => !person.parentIds.includes(p.personId!) && !descendants.has(p.personId!)),
    connectionOptions: others.filter((p) => !person.connectionIds.includes(p.personId!)),
    /** At two parents already, so the parent half of the form is closed off. */
    parentsFull: person.parentIds.length >= 2,
    account: accountOf(persona),
    canEdit: canEditPersona(viewer(req), person),
    birthday: formatBirthday(person.birthMonth, person.birthDay),
    colors: PERSONA_COLORS,
    months: MONTH_NAMES,
    minBirthYear: MIN_BIRTH_YEAR,
    maxBirthYear: new Date().getFullYear(),
    error: notice.error ?? null,
    warning: notice.warning ?? null,
  });
}

async function renderAccounts(req: Request, notice: { error?: string; warning?: string } = {}) {
  return render("accounts", {
    ...chrome(req, "family"),
    rows: personas(req).active(),
    error: notice.error ?? null,
    warning: notice.warning ?? null,
  });
}

/* ------------------------------------------------------------------ *
 * Static paths must be registered before /family/:id, or the param
 * route swallows them.
 * ------------------------------------------------------------------ */

familyRouter.get("/family", async (req, res, next) => {
  try {
    res.send(await renderTree(req));
  } catch (err) {
    next(err);
  }
});

familyRouter.get("/family/accounts", requireAdmin, async (req, res, next) => {
  try {
    res.send(await renderAccounts(req));
  } catch (err) {
    next(err);
  }
});

familyRouter.get("/family/new", requireAdmin, (req, res) => {
  res.send(render("person-new", { ...chrome(req, "family"), error: null }));
});

familyRouter.post("/family/people", requireAdmin, async (req, res, next) => {
  try {
    const name = str(req.body.name);
    if (!name) {
      res.status(400).send(render("person-new", { ...chrome(req, "family"), error: "A name is required." }));
      return;
    }
    const email = str(req.body.email);
    const clash = email ? findDuplicateEmailOwner(personas(req).people, email, "") : null;
    if (clash) {
      res.status(400).send(
        render("person-new", { ...chrome(req, "family"), error: `${clash.name} already uses that email.` }),
      );
      return;
    }
    const person = await peopleRepo.createPerson(name, email || null, "family");
    res.redirect(`/family/${person.id}`);
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- accounts ---------------------------- */

// Granting access happens only from a person's page (POST
// /family/:id/account), so every account has somebody on the tree.

familyRouter.post("/family/accounts/:email/role", requireAdmin, async (req, res, next) => {
  try {
    const role = req.body.role;
    if (!VALID_ROLES.includes(role)) {
      res.status(400).send(await renderAccounts(req, { error: "Invalid role." }));
      return;
    }
    await usersRepo.setRole(req.params.email, role as UserRole);
    res.redirect("/family/accounts");
  } catch (err) {
    if (err instanceof Error && (err.message === LAST_ADMIN_ERROR || err.message === CROSS_CIRCLE_ERROR)) {
      res.status(400).send(await renderAccounts(req, { error: err.message }));
      return;
    }
    next(err);
  }
});

familyRouter.post("/family/accounts/:email/delete", requireAdmin, async (req, res, next) => {
  try {
    const { iapFailed } = await usersRepo.deleteUser(req.params.email);
    if (iapFailed) {
      await refreshPersonas(req);
      res.send(await renderAccounts(req, { warning: IAP_SYNC_WARNING }));
      return;
    }
    res.redirect("/family/accounts");
  } catch (err) {
    if (err instanceof Error && err.message === LAST_ADMIN_ERROR) {
      res.status(400).send(await renderAccounts(req, { error: err.message }));
      return;
    }
    next(err);
  }
});

/* ----------------------------- person ----------------------------- */

/**
 * Every /family/:id route is about somebody on the tree. A friend's id is
 * a 404 here — they're managed from /friends — so no hand-posted form can
 * give a friend parents, a family account, or a place on the tree.
 */
familyRouter.param("id", (req, res, next, id: string) => {
  if (personas(req).byId(id)?.circle !== "family") {
    res.status(404).send("Person not found");
    return;
  }
  next();
});

function allOnTree(req: Request, ids: string[]): boolean {
  return ids.every((id) => personas(req).byId(id)?.circle === "family");
}

familyRouter.get("/family/:id", async (req, res, next) => {
  try {
    const html = await renderPerson(req, req.params.id);
    if (!html) {
      res.status(404).send("Person not found");
      return;
    }
    res.send(html);
  } catch (err) {
    next(err);
  }
});

/** The one route a non-admin can POST to — and only for their own card. */
familyRouter.post("/family/:id/persona", async (req, res, next) => {
  try {
    const person = await peopleRepo.getPerson(req.params.id);
    if (!person) {
      res.status(404).send("Person not found");
      return;
    }
    if (!canEditPersona(viewer(req), person)) {
      res.status(403).send(render("forbidden", { message: "You can only edit your own details." }));
      return;
    }
    const parsed = parsePersona(req.body);
    if ("error" in parsed) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: parsed.error }));
      return;
    }
    await peopleRepo.updatePersona(req.params.id, parsed);
    res.redirect(`/family/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

familyRouter.post("/family/:id/email", requireAdmin, async (req, res, next) => {
  try {
    const email = str(req.body.email);
    const persona = personas(req).byId(req.params.id);
    if (!persona) {
      res.status(404).send("Person not found");
      return;
    }
    const unchanged = (persona.email ?? "") === (email ? normalizeEmail(email) : "");
    if (persona.role && !unchanged) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: HAS_ACCESS_EMAIL_ERROR }));
      return;
    }
    if (email) {
      const clash = findDuplicateEmailOwner(personas(req).people, email, req.params.id);
      if (clash) {
        res.status(400).send(
          await renderPerson(req, req.params.id, {
            error: `${clash.name} already uses that email. Two people sharing one email would both count as the same signed-in person.`,
          }),
        );
        return;
      }
    }
    await peopleRepo.setEmail(req.params.id, email || null);
    res.redirect(`/family/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

/** Grant or revoke this person's ability to sign in. */
familyRouter.post("/family/:id/account", requireAdmin, async (req, res, next) => {
  try {
    const person = await peopleRepo.getPerson(req.params.id);
    if (!person) {
      res.status(404).send("Person not found");
      return;
    }
    if (!person.email) {
      res.status(400).send(
        await renderPerson(req, req.params.id, { error: "Add an email for this person first." }),
      );
      return;
    }

    const action = str(req.body.action);
    const role = VALID_ROLES.includes(req.body.role) ? (req.body.role as UserRole) : "member";

    const { iapFailed } =
      action === "revoke"
        ? await usersRepo.deleteUser(person.email)
        : await usersRepo.createUser(person.email, role);

    if (iapFailed) {
      await refreshPersonas(req);
      res.send(await renderPerson(req, req.params.id, { warning: IAP_SYNC_WARNING }));
      return;
    }
    res.redirect(`/family/${req.params.id}`);
  } catch (err) {
    if (err instanceof Error && err.message === LAST_ADMIN_ERROR) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: err.message }));
      return;
    }
    next(err);
  }
});

/* -------------------------- relationships ------------------------- */

/**
 * One editor, two kinds of link: a parent relationship (one or two people
 * on the row above) or a connection (one person alongside). Both are
 * added here and removed by the sibling route below, so the person page
 * has a single relationships section rather than one form per kind.
 */
familyRouter.post("/family/:id/relationships", requireAdmin, async (req, res, next) => {
  try {
    const kind = str(req.body.kind);
    if (!RELATIONSHIP_KINDS.includes(kind)) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: "Choose a kind of relationship." }));
      return;
    }

    const ids = parsePersonIds(kind === "parent" ? req.body.parentIds : req.body.connectionId);
    if (ids.length === 0) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: "Choose at least one person." }));
      return;
    }
    if (!allOnTree(req, ids)) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: MISSING_PERSON_ERROR }));
      return;
    }

    if (kind === "parent") {
      await peopleRepo.addParents(req.params.id, ids);
    } else {
      await peopleRepo.addConnection(req.params.id, ids[0]!);
    }
    res.redirect(`/family/${req.params.id}`);
  } catch (err) {
    if (err instanceof Error && RELATIONSHIP_ERRORS.includes(err.message)) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: err.message }));
      return;
    }
    next(err);
  }
});

familyRouter.post("/family/:id/relationships/remove", requireAdmin, async (req, res, next) => {
  try {
    const kind = str(req.body.kind);
    const otherId = str(req.body.otherId);
    if (!RELATIONSHIP_KINDS.includes(kind) || !otherId) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: "Nothing to remove." }));
      return;
    }

    if (kind === "parent") {
      await peopleRepo.removeParent(req.params.id, otherId);
    } else {
      await peopleRepo.removeConnection(req.params.id, otherId);
    }
    res.redirect(`/family/${req.params.id}`);
  } catch (err) {
    if (err instanceof Error && RELATIONSHIP_ERRORS.includes(err.message)) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: err.message }));
      return;
    }
    next(err);
  }
});

familyRouter.post("/family/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    if (personas(req).byId(req.params.id)?.role) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: HAS_ACCESS_DELETE_ERROR }));
      return;
    }
    // An exchange naming somebody who no longer exists would draw them as
    // an unknown face and leave their Santa buying for nobody.
    if (await secretSantaRepo.isParticipantAnywhere(req.params.id)) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: IN_EXCHANGE_ERROR }));
      return;
    }
    await peopleRepo.deletePerson(req.params.id);
    res.redirect("/family");
  } catch (err) {
    next(err);
  }
});
