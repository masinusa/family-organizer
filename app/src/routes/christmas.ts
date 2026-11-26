import { Router, type Request, type Response } from "express";
import { chrome } from "../lib/chrome.js";
import type { Persona } from "../lib/persona.js";
import { render } from "../lib/render.js";
import {
  assignmentError,
  brokenRules,
  drawAssignments,
  drawExclusions,
  formatExchangeDate,
  isParticipant,
  NO_VALID_DRAW_ERROR,
  parseAssignments,
  parseDetails,
  recipientOf,
  TOO_FEW_ERROR,
  unassignedIds,
} from "../lib/secret-santa.js";
import { EXCHANGE_EXISTS_ERROR, secretSantaRepo } from "../lib/secret-santa-repo.js";
import type { SecretSantaDoc, WishItem } from "../lib/types.js";
import { linkHost, MAX_ITEMS, parseWishlist, wishlistText } from "../lib/wishlist.js";
import { isAdmin, requireAdmin } from "../middleware/access-control.js";

/**
 * The Christmas page, starting with Secret Santa. The feature gate has
 * already decided this viewer may be on /christmas at all (family, or a
 * friend taking part); everything here is about *which* exchange, and
 * which single pair of it, they may see.
 *
 * The one secret is `assignments`. A participant's page carries only their
 * own recipient. An admin's page is identical unless they open the full
 * list on purpose (`?all=1`), so running the exchange doesn't spoil it.
 */
export const christmasRouter = Router();

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function parseYear(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

function myId(req: Request): string {
  return req.persona!.personId!;
}

function canSee(req: Request, exchange: SecretSantaDoc): boolean {
  return isAdmin(req) || isParticipant(exchange, myId(req));
}

/**
 * Deleting anyone still in an exchange is refused (routes/family.ts,
 * routes/friends.ts), so an id that resolves to nobody is a bug.
 */
function personaFor(req: Request, id: string): Persona {
  const persona = req.personas!.byId(id);
  if (!persona) throw new Error(`Secret Santa names person ${id}, who no longer exists.`);
  return persona;
}

function byName(a: Persona, b: Persona): number {
  return a.name.localeCompare(b.name);
}

function details(exchange: SecretSantaDoc) {
  return {
    year: exchange.year,
    budget: exchange.budget === null ? null : `$${exchange.budget}`,
    date: exchange.exchangeDate === null ? null : formatExchangeDate(exchange.exchangeDate),
    drawn: Object.keys(exchange.assignments).length > 0,
    count: exchange.participantIds.length,
  };
}

/** What anybody's card or page may say about their own part in it. */
function mine(req: Request, exchange: SecretSantaDoc) {
  const recipientId = recipientOf(exchange, myId(req));
  return {
    isIn: isParticipant(exchange, myId(req)),
    recipient: recipientId ? personaFor(req, recipientId) : null,
  };
}

/** 404, not 403, for an exchange you can't see: no confirming it exists. */
async function loadVisible(req: Request, res: Response): Promise<SecretSantaDoc | null> {
  const year = parseYear(req.params.year);
  const exchange = year === null ? null : await secretSantaRepo.getExchange(year);
  if (!exchange || !canSee(req, exchange)) {
    res.status(404).send("Not found");
    return null;
  }
  return exchange;
}

interface Notice {
  error?: string;
  /** Force the full list open — a rejected hand edit re-renders inside it. */
  showAll?: boolean;
  /** A rejected hand edit, so the table re-renders with what was picked. */
  draft?: Record<string, string>;
  /** A rejected wish list, so nobody loses what they typed. */
  wishlistDraft?: string;
}

/**
 * Your own list to edit, and the list of whoever you're buying for — the
 * only two a page ever carries. Nobody reads anyone else's, admins
 * included: the full assignment list doesn't come with everybody's lists.
 */
async function wishlists(req: Request, exchange: SecretSantaDoc, notice: Notice) {
  if (!isParticipant(exchange, myId(req))) return { myWishlist: null, theirWishlist: null };
  const recipientId = recipientOf(exchange, myId(req));
  const [own, theirs] = await Promise.all([
    secretSantaRepo.getWishlist(exchange.year, myId(req)),
    recipientId ? secretSantaRepo.getWishlist(exchange.year, recipientId) : Promise.resolve(null),
  ]);
  const show = (items: WishItem[]) => items.map((item) => ({ ...item, host: item.link ? linkHost(item.link) : null }));
  return {
    myWishlist: notice.wishlistDraft ?? wishlistText(own),
    theirWishlist: theirs ? show(theirs) : null,
  };
}

/**
 * Pairs in the open table that break the draw's rules, as sentences. An
 * admin may choose one deliberately, so it's said rather than refused.
 * Worked out only when the table is open: it's the only place one shows.
 */
async function ruleWarnings(req: Request, exchange: SecretSantaDoc, assignments: Record<string, string>): Promise<string[]> {
  const lastYear = (await secretSantaRepo.getExchange(exchange.year - 1))?.assignments ?? null;
  const forbidden = drawExclusions(exchange.participantIds, req.personas!.people, lastYear);
  return brokenRules(assignments, forbidden).map(([giver, receiver]) => {
    const why = lastYear?.[giver] === receiver ? "had them last year" : "are partners";
    return `${personaFor(req, giver).name} → ${personaFor(req, receiver).name}: they ${why}.`;
  });
}

async function renderExchange(req: Request, exchange: SecretSantaDoc, notice: Notice = {}): Promise<string> {
  const admin = isAdmin(req);
  const showAll = admin && (notice.showAll ?? req.query.all === "1");
  const participants = exchange.participantIds.map((id) => personaFor(req, id)).sort(byName);
  const assignments = notice.draft ?? exchange.assignments;

  return render("secret-santa", {
    ...chrome(req, "christmas"),
    exchange: details(exchange),
    values: { budget: exchange.budget ?? "", exchangeDate: exchange.exchangeDate ?? "" },
    participantIds: exchange.participantIds,
    participants,
    ...mine(req, exchange),
    ...(await wishlists(req, exchange, notice)),
    maxIdeas: MAX_ITEMS,
    isAdmin: admin,
    showAll,
    // Everything below is admin-only, and the table only with the list open.
    roster: admin ? [...req.personas!.all(), ...req.personas!.friends()].sort(byName) : [],
    unassigned: admin ? unassignedIds(exchange).map((id) => personaFor(req, id)) : [],
    assignments: showAll ? assignments : {},
    warnings: showAll ? await ruleWarnings(req, exchange, assignments) : [],
    error: notice.error ?? null,
  });
}

/* ------------------------------- hub ------------------------------- */

christmasRouter.get("/christmas", async (req, res, next) => {
  try {
    const all = await secretSantaRepo.listExchanges();
    const thisYear = new Date().getFullYear();
    const cards = all
      .filter((exchange) => canSee(req, exchange))
      .map((exchange) => ({ ...details(exchange), ...mine(req, exchange) }));

    res.send(
      render("christmas", {
        ...chrome(req, "christmas"),
        cards,
        thisYear,
        canStart: isAdmin(req) && !all.some((exchange) => exchange.year === thisYear),
      }),
    );
  } catch (err) {
    next(err);
  }
});

/* --------------------------- secret santa -------------------------- */

christmasRouter.post("/christmas/secret-santa", requireAdmin, async (req, res, next) => {
  try {
    const year = parseYear(req.body.year);
    if (year === null) {
      res.status(400).send("Invalid year");
      return;
    }
    try {
      await secretSantaRepo.createExchange(year, req.user!.email);
    } catch (err) {
      // Two admins pressing Start at once: the second just lands on it.
      if (!(err instanceof Error && err.message === EXCHANGE_EXISTS_ERROR)) throw err;
    }
    res.redirect(`/christmas/secret-santa/${year}`);
  } catch (err) {
    next(err);
  }
});

christmasRouter.get("/christmas/secret-santa/:year", async (req, res, next) => {
  try {
    const exchange = await loadVisible(req, res);
    if (!exchange) return;
    res.send(await renderExchange(req, exchange));
  } catch (err) {
    next(err);
  }
});

christmasRouter.post("/christmas/secret-santa/:year/details", requireAdmin, async (req, res, next) => {
  try {
    const exchange = await loadVisible(req, res);
    if (!exchange) return;
    const parsed = parseDetails(req.body);
    if ("error" in parsed) {
      res.status(400).send(await renderExchange(req, exchange, { error: parsed.error }));
      return;
    }
    await secretSantaRepo.setDetails(exchange.year, parsed.budget, parsed.exchangeDate);
    res.redirect(`/christmas/secret-santa/${exchange.year}`);
  } catch (err) {
    next(err);
  }
});

/** Checkbox values from the persona picker: an array, a bare string, or nothing. */
function parseIds(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : [];
  return Array.from(new Set(values.filter((v): v is string => typeof v === "string" && v !== "")));
}

christmasRouter.post("/christmas/secret-santa/:year/participants", requireAdmin, async (req, res, next) => {
  try {
    const exchange = await loadVisible(req, res);
    if (!exchange) return;
    const ids = parseIds(req.body.participantIds);
    // The picker only offers real people; a hand-posted id that isn't one
    // would be drawn as somebody nobody can sign in as.
    if (!ids.every((id) => req.personas!.byId(id)?.kind === "person")) {
      res.status(400).send(await renderExchange(req, exchange, { error: "That person isn't here any more." }));
      return;
    }
    await secretSantaRepo.setParticipants(exchange.year, ids);
    res.redirect(`/christmas/secret-santa/${exchange.year}`);
  } catch (err) {
    next(err);
  }
});

/**
 * Lands back on the page *without* the full list, so pressing Draw never
 * shows the admin who got whom.
 */
christmasRouter.post("/christmas/secret-santa/:year/draw", requireAdmin, async (req, res, next) => {
  try {
    const exchange = await loadVisible(req, res);
    if (!exchange) return;
    const lastYear = await secretSantaRepo.getExchange(exchange.year - 1);
    const forbidden = drawExclusions(exchange.participantIds, req.personas!.people, lastYear?.assignments ?? null);
    let assignments: Record<string, string>;
    try {
      assignments = drawAssignments(exchange.participantIds, forbidden);
    } catch (err) {
      if (err instanceof Error && (err.message === NO_VALID_DRAW_ERROR || err.message === TOO_FEW_ERROR)) {
        res.status(400).send(await renderExchange(req, exchange, { error: err.message }));
        return;
      }
      throw err;
    }
    await secretSantaRepo.setAssignments(exchange.year, assignments, true);
    res.redirect(`/christmas/secret-santa/${exchange.year}`);
  } catch (err) {
    next(err);
  }
});

christmasRouter.post("/christmas/secret-santa/:year/assignments", requireAdmin, async (req, res, next) => {
  try {
    const exchange = await loadVisible(req, res);
    if (!exchange) return;
    const assignments = parseAssignments(req.body, exchange.participantIds);
    const error = assignmentError(exchange.participantIds, assignments);
    if (error) {
      res.status(400).send(await renderExchange(req, exchange, { error, showAll: true, draft: assignments }));
      return;
    }
    await secretSantaRepo.setAssignments(exchange.year, assignments, false);
    res.redirect(`/christmas/secret-santa/${exchange.year}?all=1`);
  } catch (err) {
    next(err);
  }
});

/**
 * Only ever the viewer's own list: the id is their persona's, never a
 * form field, so there's no list here anyone could post on someone
 * else's behalf. Admins not taking part have no list to write.
 */
christmasRouter.post("/christmas/secret-santa/:year/wishlist", async (req, res, next) => {
  try {
    const exchange = await loadVisible(req, res);
    if (!exchange) return;
    if (!isParticipant(exchange, myId(req))) {
      res.status(404).send("Not found");
      return;
    }
    const raw = typeof req.body.wishlist === "string" ? req.body.wishlist : "";
    const items = parseWishlist(raw);
    if ("error" in items) {
      res.status(400).send(await renderExchange(req, exchange, { error: items.error, wishlistDraft: raw }));
      return;
    }
    await secretSantaRepo.setWishlist(exchange.year, myId(req), items);
    res.redirect(`/christmas/secret-santa/${exchange.year}#wishlist`);
  } catch (err) {
    next(err);
  }
});
