import { Router, type Request } from "express";
import { isAdmin, requireAdmin } from "../middleware/access-control.js";
import { render } from "../lib/render.js";
import { normalizeEmail } from "../lib/email.js";
import {
  peopleRepo,
  TOO_MANY_PARENTS_ERROR,
  SELF_PARENT_ERROR,
  CYCLE_PARENT_ERROR,
} from "../lib/people-repo.js";
import * as usersRepo from "../lib/users-repo.js";
import { IAP_SYNC_WARNING, LAST_ADMIN_ERROR } from "../lib/users-repo.js";
import {
  canEditPersona,
  findDuplicateEmailOwner,
  findPersonForEmail,
  matchAccounts,
} from "../lib/family-link.js";
import {
  colorFor,
  formatBirthday,
  initialsFor,
  isValidBirthYear,
  MIN_BIRTH_YEAR,
  MONTH_NAMES,
  PERSONA_COLORS,
} from "../lib/persona.js";
import { buildTreeLayout } from "../lib/tree-layout.js";
import type { PersonDoc, PersonaInput, UserRole } from "../lib/types.js";

export const familyRouter = Router();

const PARENT_ERRORS: string[] = [TOO_MANY_PARENTS_ERROR, SELF_PARENT_ERROR, CYCLE_PARENT_ERROR];
const VALID_ROLES: UserRole[] = ["admin", "member"];
const BLURB_MAX = 60;

function viewer(req: Request): { email: string; role: UserRole } {
  return { email: req.appUser!.email, role: req.appUser!.role };
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

function parseParentIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string" && v !== "");
  return typeof raw === "string" && raw ? [raw] : [];
}

/** Shared chrome every page needs for the nav. */
function chrome(req: Request) {
  return { email: req.user?.email, isAdmin: isAdmin(req), active: "family" };
}

async function renderTree(req: Request) {
  const [people, users] = await Promise.all([peopleRepo.listPeople(), usersRepo.listUsers()]);
  const { accountByPersonId } = matchAccounts(people, users);
  const you = findPersonForEmail(people, viewer(req).email);
  const layout = buildTreeLayout(people);

  // The template stays dumb — everything it needs is resolved here, the
  // same way calendar.eta just walks a pre-built grid.
  const cards = layout.cards.map((card) => ({
    ...card,
    initials: initialsFor(card.person.name),
    swatch: colorFor(card.person),
    birthday: formatBirthday(card.person.birthMonth, card.person.birthDay),
    account: accountByPersonId.get(card.person.id) ?? null,
    hasAccount: accountByPersonId.has(card.person.id),
    isYou: you?.id === card.person.id,
  }));

  return render("family", { ...chrome(req), layout, cards });
}

/** Null when the person doesn't exist, so callers can 404. */
async function renderPerson(req: Request, id: string, notice: { error?: string; warning?: string } = {}) {
  const [person, people, users] = await Promise.all([
    peopleRepo.getPerson(id),
    peopleRepo.listPeople(),
    usersRepo.listUsers(),
  ]);
  if (!person) return null;

  const { accountByPersonId, orphanAccounts } = matchAccounts(people, users);
  const byId = new Map(people.map((p) => [p.id, p]));
  const resolve = (ids: string[]) => ids.map((pid) => byId.get(pid)).filter((p): p is PersonDoc => !!p);

  return render("person", {
    ...chrome(req),
    person,
    people: people.filter((p) => p.id !== person.id),
    parents: resolve(person.parentIds),
    partners: resolve(person.partnerIds),
    children: people.filter((p) => p.parentIds.includes(person.id)),
    account: accountByPersonId.get(person.id) ?? null,
    // Accounts belonging to nobody on the tree yet — the candidates for
    // "link this person to an existing account".
    linkableAccounts: orphanAccounts,
    canEdit: canEditPersona(viewer(req), person),
    initials: initialsFor(person.name),
    swatch: colorFor(person),
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
  const [people, users] = await Promise.all([peopleRepo.listPeople(), usersRepo.listUsers()]);
  const { orphanAccounts } = matchAccounts(people, users);
  const orphans = new Set(orphanAccounts.map((u) => normalizeEmail(u.email)));

  const rows = users.map((user) => ({
    user,
    person: findPersonForEmail(people, user.email),
    isOrphan: orphans.has(normalizeEmail(user.email)),
  }));

  return render("accounts", {
    ...chrome(req),
    rows,
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
  res.send(render("person-new", { ...chrome(req), error: null }));
});

familyRouter.post("/family/people", requireAdmin, async (req, res, next) => {
  try {
    const name = str(req.body.name);
    if (!name) {
      res.status(400).send(render("person-new", { ...chrome(req), error: "A name is required." }));
      return;
    }
    const email = str(req.body.email);
    const person = await peopleRepo.createPerson(name, email || null);
    res.redirect(`/family/${person.id}`);
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- accounts ---------------------------- */

familyRouter.post("/family/accounts", requireAdmin, async (req, res, next) => {
  try {
    const email = str(req.body.email);
    const role = req.body.role;
    if (!email || !VALID_ROLES.includes(role)) {
      res.status(400).send(await renderAccounts(req, { error: "A valid email and role are required." }));
      return;
    }
    const { iapFailed } = await usersRepo.createUser(email, role as UserRole);
    if (iapFailed) {
      res.send(await renderAccounts(req, { warning: IAP_SYNC_WARNING }));
      return;
    }
    res.redirect("/family/accounts");
  } catch (err) {
    next(err);
  }
});

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
    if (err instanceof Error && err.message === LAST_ADMIN_ERROR) {
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
    if (email) {
      const people = await peopleRepo.listPeople();
      const clash = findDuplicateEmailOwner(people, email, req.params.id);
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

familyRouter.post("/family/:id/parents", requireAdmin, async (req, res, next) => {
  try {
    await peopleRepo.setParents(req.params.id, parseParentIds(req.body.parentIds));
    res.redirect(`/family/${req.params.id}`);
  } catch (err) {
    if (err instanceof Error && PARENT_ERRORS.includes(err.message)) {
      res.status(400).send(await renderPerson(req, req.params.id, { error: err.message }));
      return;
    }
    next(err);
  }
});

familyRouter.post("/family/:id/partners", requireAdmin, async (req, res, next) => {
  try {
    const partnerId = str(req.body.partnerId);
    if (!partnerId || partnerId === req.params.id) {
      res.status(400).send(
        await renderPerson(req, req.params.id, { error: "Choose a different person as a partner." }),
      );
      return;
    }
    await peopleRepo.addPartner(req.params.id, partnerId);
    res.redirect(`/family/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

familyRouter.post("/family/:id/partners/:partnerId/remove", requireAdmin, async (req, res, next) => {
  try {
    await peopleRepo.removePartner(req.params.id, req.params.partnerId);
    res.redirect(`/family/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

familyRouter.post("/family/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await peopleRepo.deletePerson(req.params.id);
    res.redirect("/family");
  } catch (err) {
    next(err);
  }
});
