import { Router, type Request } from "express";
import { chrome } from "../lib/chrome.js";
import { findDuplicateEmailOwner } from "../lib/family-link.js";
import { FEATURES, parseOptIns } from "../lib/features.js";
import { peopleRepo } from "../lib/people-repo.js";
import type { Persona } from "../lib/persona.js";
import { render } from "../lib/render.js";
import { IAP_SYNC_WARNING, usersRepo } from "../lib/users-repo.js";
import { requireAdmin } from "../middleware/access-control.js";
import { loadPersonaDirectory } from "../middleware/personas.js";

/**
 * Friends: people who sign in for a feature or two without being on the
 * tree. Admin only, and deliberately not in lib/features.ts — a path no
 * feature claims is family only, so no friend can open this page even
 * before requireAdmin runs.
 *
 * A friend is always created *with* an account: being able to sign in for
 * something is the only reason to add one. That's also why there's no
 * separate grant/revoke here, unlike a family member's card.
 */
export const friendsRouter = Router();

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function friendOr404(req: Request, id: string): Persona | null {
  const persona = req.personas!.byId(id);
  return persona?.circle === "friend" ? persona : null;
}

function renderFriends(req: Request, notice: { error?: string; warning?: string } = {}): string {
  const directory = req.personas!;
  const friends = directory.friends().map((persona) => {
    const optIns = directory.optInsOf(persona);
    return {
      persona,
      optIns,
      reach: FEATURES.filter((feature) => optIns.includes(feature.key)).map((feature) => feature.label),
    };
  });

  return render("friends", {
    ...chrome(req, "family"),
    friends,
    features: FEATURES,
    error: notice.error ?? null,
    warning: notice.warning ?? null,
  });
}

friendsRouter.get("/friends", requireAdmin, (req, res) => {
  res.send(renderFriends(req));
});

friendsRouter.post("/friends", requireAdmin, async (req, res, next) => {
  try {
    const name = str(req.body.name);
    const email = str(req.body.email);
    if (!name || !email) {
      res.status(400).send(renderFriends(req, { error: "A friend needs a name and the Google email they'll sign in with." }));
      return;
    }
    // Everyone shares one email namespace: a friend and a family member on
    // one address would both be "you" to the sign-in join.
    const clash = findDuplicateEmailOwner(req.personas!.people, email, "");
    if (clash) {
      res.status(400).send(renderFriends(req, { error: `${clash.name} already uses that email.` }));
      return;
    }

    await peopleRepo.createPerson(name, email, "friend");
    const { iapFailed } = await usersRepo.createUser(email, "friend");
    if (iapFailed) {
      req.personas = await loadPersonaDirectory();
      res.send(renderFriends(req, { warning: IAP_SYNC_WARNING }));
      return;
    }
    res.redirect("/friends");
  } catch (err) {
    next(err);
  }
});

friendsRouter.post("/friends/:id/access", requireAdmin, async (req, res, next) => {
  try {
    const friend = friendOr404(req, req.params.id);
    if (!friend) {
      res.status(404).send("Friend not found");
      return;
    }
    const optIns = parseOptIns(req.body.optIns);
    if ("error" in optIns) {
      res.status(400).send(renderFriends(req, { error: optIns.error }));
      return;
    }
    await usersRepo.setOptIns(friend.email!, optIns);
    res.redirect("/friends");
  } catch (err) {
    next(err);
  }
});

/**
 * Account first, then the person: deleting the person first would leave,
 * for a moment, an account nobody owns — which PersonaDirectory refuses,
 * breaking every page until it was cleaned up.
 */
friendsRouter.post("/friends/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    const friend = friendOr404(req, req.params.id);
    if (!friend) {
      res.status(404).send("Friend not found");
      return;
    }
    const { iapFailed } = friend.role ? await usersRepo.deleteUser(friend.email!) : { iapFailed: false };
    await peopleRepo.deletePerson(friend.personId!);
    if (iapFailed) {
      req.personas = await loadPersonaDirectory();
      res.send(renderFriends(req, { warning: IAP_SYNC_WARNING }));
      return;
    }
    res.redirect("/friends");
  } catch (err) {
    next(err);
  }
});
