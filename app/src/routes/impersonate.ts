import { Router, type NextFunction, type Request, type Response } from "express";
import { normalizeEmail } from "../lib/email.js";
import { render } from "../lib/render.js";
import { usersRepo } from "../lib/users-repo.js";
import {
  realAdmin,
  realEmail,
  startImpersonating,
  stopImpersonating,
} from "../middleware/impersonation.js";
import { loadPersonaDirectory } from "../middleware/personas.js";

export const impersonateRouter = Router();

/**
 * Where to land after switching identity. Rebuilt from a parsed URL
 * rather than echoed back, and only ever a path on this site — the same
 * rule safeCalendarReturn() follows in lib/calendar-page.ts.
 */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  // A backslash is normalized to a slash by browsers, so "/\evil.com"
  // would leave the site even though it starts with a single slash.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const url = new URL(raw, "http://family-hub.invalid");
    return url.pathname.startsWith("//") ? "/" : url.pathname + url.search;
  } catch {
    return "/";
  }
}

/**
 * Not requireAdmin: that reads req.appUser, which while impersonating is
 * the person being impersonated. These routes answer to the real account.
 */
async function requireRealAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!(await realAdmin(req))) {
      res.status(403).send(render("forbidden", { message: "Only an admin can view the site as somebody else." }));
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * The account list as a bare fragment, fetched when the picker opens
 * rather than rendered into every page. Same pattern as GET
 * /events/:id/card. Mounted ahead of requireFamilyMember (see app.ts), so
 * req.personas isn't loaded yet and this reads its own.
 */
impersonateRouter.get("/impersonate/picker", requireRealAdmin, async (req, res, next) => {
  try {
    const me = realEmail(req);
    const personas = await loadPersonaDirectory();
    // Friends too: checking what a friend can and can't reach is the most
    // likely reason to view as somebody.
    const options = personas.withAccounts().filter((persona) => persona.email !== me);

    res.send(
      render("_view-as", {
        options,
        realName: personas.forEmail(me).name,
        current: req.impersonator ? normalizeEmail(req.user!.email) : null,
        returnTo: safeReturnPath(req.query.return),
      }),
    );
  } catch (err) {
    next(err);
  }
});

impersonateRouter.post("/impersonate", requireRealAdmin, async (req, res, next) => {
  try {
    const returnTo = safeReturnPath(req.body?.return);
    const email = normalizeEmail(typeof req.body?.email === "string" ? req.body.email : "");

    if (!email || email === realEmail(req)) {
      stopImpersonating(res);
      res.redirect(returnTo);
      return;
    }

    // The picker only offers accounts that exist, so this is the hand-posted
    // case. Checked here because a typo would otherwise 403 every page.
    if (!(await usersRepo.getUser(email))) {
      res.status(400).send(render("forbidden", { message: `There's no account here for ${email}.` }));
      return;
    }

    startImpersonating(res, email);
    res.redirect(returnTo);
  } catch (err) {
    next(err);
  }
});

/**
 * Unguarded on purpose: clearing your own cookie can't grant anything,
 * and it has to work even when the account being impersonated has since
 * been deleted — which is exactly when every other page 403s.
 */
impersonateRouter.post("/impersonate/stop", (req, res) => {
  stopImpersonating(res);
  res.redirect(safeReturnPath(req.body?.return));
});
