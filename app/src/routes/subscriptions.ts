import { Router, type Request, type Response } from "express";
import { chrome } from "../lib/chrome.js";
import { render } from "../lib/render.js";
import * as subscriptionsRepo from "../lib/subscriptions-repo.js";
import { canView, visibleTo, type Viewer } from "../lib/subscription-access.js";
import {
  parseMemberEmails,
  parsePasswordVersion,
  parseSubscriptionInput,
} from "../lib/subscription-input.js";
import { LATEST_VERSION, secretStore, subscriptionSecretId } from "../lib/secret-store.js";
import { isFamilyMailbox, mailbox, WINDOW_DAYS } from "../lib/mailbox.js";
import { isAdmin, requireAdmin } from "../middleware/access-control.js";
import { realEmail } from "../middleware/impersonation.js";
import type { MailMessage } from "../lib/mailbox.js";
import type { RevealDoc, SubscriptionDoc } from "../lib/types.js";

export const subscriptionsRouter = Router();

const PASSWORD_MAX = 200;

/**
 * Who the vault is being read *as*, which while an admin is impersonating is
 * the member they picked — that's the point of viewing as somebody, and it
 * is what makes the access list testable from the other side.
 *
 * Note the audit trail deliberately does not follow this: `realEmail(req)`
 * records who actually pressed the button. "Mum got the password" when an
 * admin did, viewing as Mum, would be a false entry in exactly the record
 * the vault leans on (ADR 0007).
 */
function viewer(req: Request): Viewer {
  return { email: req.appUser!.email, role: req.appUser!.role };
}

/**
 * A response carrying a password or mailbox content must not sit in a
 * shared cache or come back on a Back-button press.
 */
function noStore(res: Response): Response {
  return res.set("Cache-Control", "no-store");
}

interface Notice {
  error?: string;
  warning?: string;
  /** Rendered once, never stored, never logged. */
  password?: string;
  /** Which stored password is in `password`: a version id, or null for the current one. */
  passwordVersion?: string | null;
  saved?: boolean;
  mail?: MailMessage[];
}

/**
 * Reading back an old password is a different act from taking the current
 * one, so the log says which — but only against the version that was
 * current at render time, since what counts as "old" moves on every save.
 */
function revealLabel(reveal: RevealDoc, currentVersion: string | null): string {
  if (reveal.action === "mail") return "read this service's mail";
  if (reveal.version && reveal.version !== currentVersion) return "got an old password";
  return "got the password";
}

async function renderList(req: Request): Promise<string> {
  const all = await subscriptionsRepo.listSubscriptions();
  const subscriptions = visibleTo(viewer(req), all).map((subscription) => ({
    ...subscription,
    members: subscription.memberEmails.map((email) => req.personas!.forEmail(email)),
  }));

  return render("subscriptions", {
    ...chrome(req, "vault"),
    subscriptions,
    // An admin sees everything, so an empty list means nothing exists yet —
    // worth saying differently from "nothing is shared with you".
    seesAll: isAdmin(req),
  });
}

/** Null when it doesn't exist or this viewer may not see it — callers 404/403. */
async function renderDetail(
  req: Request,
  id: string,
  notice: Notice = {},
): Promise<string | null> {
  const subscription = await subscriptionsRepo.getSubscription(id);
  if (!subscription) return null;
  if (!canView(viewer(req), subscription)) return null;

  const personas = req.personas!;
  const [reveals, passwordVersions] = await Promise.all([
    subscriptionsRepo.listReveals(id),
    subscriptionsRepo.listPasswordVersions(id),
  ]);

  // listPasswordVersions is newest first, so the head is the one "Get
  // password" hands over — which is what labels a reveal of the current
  // password with who last changed it.
  const current = passwordVersions[0] ?? null;
  const revealed =
    notice.password === undefined
      ? null
      : (passwordVersions.find((entry) => entry.version === notice.passwordVersion) ?? current);

  return render("subscription", {
    ...chrome(req, "vault"),
    subscription,
    // Eta renders a null as the literal "null", so the edit form gets an
    // all-strings copy — the same reason event-input.ts has FormValues.
    values: {
      name: subscription.name,
      accountEmail: subscription.accountEmail ?? "",
      accountPhone: subscription.accountPhone ?? "",
      link: subscription.link ?? "",
      notes: subscription.notes ?? "",
      mailFrom: subscription.mailFrom ?? "",
    },
    members: subscription.memberEmails.map((email) => personas.forEmail(email)),
    // The admin access picker: everyone who can sign in, ticked if they're on.
    roster: personas.active(),
    reveals: reveals.map((reveal) => ({
      ...reveal,
      persona: personas.forEmail(reveal.email),
      label: revealLabel(reveal, current?.version ?? null),
    })),
    // Every password ever saved, newest first — nothing is replaced, so an
    // old one can still be collected from the service that never took the
    // new one.
    passwordHistory: passwordVersions.map((entry) => ({
      ...entry,
      persona: personas.forEmail(entry.setBy),
      current: entry.version === current?.version,
    })),
    // A stored password with no recorded save: the only way to reach this is
    // a logPasswordVersion write that failed after its secret version
    // landed. Said out loud rather than rendered as "never set", which is a
    // different and wrong answer.
    historyMissing: subscription.hasPassword && passwordVersions.length === 0,
    // Both halves are needed: a mailbox the app can log into, and a sender
    // to narrow the search to. Without the second this would be a general
    // inbox reader, which is the thing ADR 0007 refuses to be.
    canReadMail: isFamilyMailbox(subscription.accountEmail) && Boolean(subscription.mailFrom),
    // Registered to the family mailbox but with no sender set: an admin is
    // one field away from turning the search on, so say so instead of
    // silently offering nothing.
    mailNeedsSender: isFamilyMailbox(subscription.accountEmail) && !subscription.mailFrom,
    windowDays: WINDOW_DAYS,
    error: notice.error ?? null,
    warning: notice.warning ?? null,
    password: notice.password ?? null,
    revealed: revealed ? { ...revealed, persona: personas.forEmail(revealed.setBy) } : null,
    revealedIsCurrent: notice.passwordVersion == null || notice.passwordVersion === current?.version,
    saved: notice.saved === true,
    mail: notice.mail ?? null,
  });
}

/**
 * Loads a subscription for a POST, 404-ing on both "no such thing" and "not
 * yours" so the vault never confirms that a subscription exists to someone
 * who can't see it.
 */
async function loadForWrite(req: Request, res: Response): Promise<SubscriptionDoc | null> {
  const subscription = await subscriptionsRepo.getSubscription(req.params.id!);
  if (!subscription || !canView(viewer(req), subscription)) {
    res.status(404).send("Subscription not found");
    return null;
  }
  return subscription;
}

async function sendDetail(req: Request, res: Response, notice: Notice, status = 200): Promise<void> {
  const html = await renderDetail(req, req.params.id!, notice);
  if (!html) {
    res.status(404).send("Subscription not found");
    return;
  }
  res.status(status).send(html);
}

/* ------------------------------------------------------------------ *
 * Static paths must be registered before /subscriptions/:id, or the
 * param route swallows them.
 * ------------------------------------------------------------------ */

subscriptionsRouter.get("/subscriptions", async (req, res, next) => {
  try {
    res.send(await renderList(req));
  } catch (err) {
    next(err);
  }
});

subscriptionsRouter.get("/subscriptions/new", requireAdmin, (req, res) => {
  res.send(render("subscription-new", { ...chrome(req, "vault"), error: null }));
});

subscriptionsRouter.post("/subscriptions", requireAdmin, async (req, res, next) => {
  try {
    const parsed = parseSubscriptionInput(req.body);
    if ("error" in parsed) {
      res.status(400).send(render("subscription-new", { ...chrome(req, "vault"), error: parsed.error }));
      return;
    }
    const id = await subscriptionsRepo.createSubscription(parsed, req.user!.email);
    res.redirect(`/subscriptions/${id}`);
  } catch (err) {
    next(err);
  }
});

subscriptionsRouter.get("/subscriptions/:id", async (req, res, next) => {
  try {
    // Saving a password redirects rather than rendering, so the password
    // never sits in a resubmittable POST response; the flag is how the
    // confirmation survives that.
    const html = await renderDetail(req, req.params.id, { saved: req.query.saved === "1" });
    if (!html) {
      res.status(404).send("Subscription not found");
      return;
    }
    res.send(html);
  } catch (err) {
    next(err);
  }
});

subscriptionsRouter.post("/subscriptions/:id", requireAdmin, async (req, res, next) => {
  try {
    if (!(await loadForWrite(req, res))) return;
    const parsed = parseSubscriptionInput(req.body);
    if ("error" in parsed) {
      await sendDetail(req, res, { error: parsed.error }, 400);
      return;
    }
    await subscriptionsRepo.updateSubscription(req.params.id, parsed);
    res.redirect(`/subscriptions/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

subscriptionsRouter.post("/subscriptions/:id/access", requireAdmin, async (req, res, next) => {
  try {
    if (!(await loadForWrite(req, res))) return;
    const emails = parseMemberEmails(
      req.body,
      req.personas!.active().map((persona) => persona.email!),
    );
    await subscriptionsRepo.setMemberEmails(req.params.id, emails);
    res.redirect(`/subscriptions/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- password ---------------------------- */

/**
 * Anyone on the access list, not just an admin: they can already collect the
 * password and change it at the service itself, so the only thing an admin
 * gate would buy is a vault that goes stale the moment someone rotates one.
 * Who saved it is recorded instead.
 */
subscriptionsRouter.post("/subscriptions/:id/password", async (req, res, next) => {
  try {
    if (!(await loadForWrite(req, res))) return;

    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!password) {
      await sendDetail(req, res, { error: "Enter a password to store." }, 400);
      return;
    }
    if (password.length > PASSWORD_MAX) {
      await sendDetail(
        req,
        res,
        { error: `A password must be ${PASSWORD_MAX} characters or fewer.` },
        400,
      );
      return;
    }

    // Firestore's flag is only flipped once the secret is really stored, so
    // the two can never claim a password the vault can't produce. The
    // history entry comes last for the same reason in reverse: if it fails,
    // the new password is still the one the vault hands out — it just isn't
    // attributed, which beats a password nobody can get at.
    const version = await secretStore.setSecret(subscriptionSecretId(req.params.id), password);
    await subscriptionsRepo.setHasPassword(req.params.id, true);
    await subscriptionsRepo.logPasswordVersion(req.params.id, version, realEmail(req));
    noStore(res).redirect(`/subscriptions/${req.params.id}?saved=1`);
  } catch (err) {
    next(err);
  }
});

subscriptionsRouter.post("/subscriptions/:id/password/reveal", async (req, res, next) => {
  try {
    const subscription = await loadForWrite(req, res);
    if (!subscription) return;

    if (!subscription.hasPassword) {
      noStore(res);
      await sendDetail(req, res, { error: "No password is stored for this subscription yet." }, 400);
      return;
    }

    // An older password is addressed by the version it was saved as, and the
    // recorded history is what makes a version askable at all.
    const history = await subscriptionsRepo.listPasswordVersions(req.params.id);
    const parsed = parsePasswordVersion(
      req.body,
      history.map((entry) => entry.version),
    );
    if ("error" in parsed) {
      noStore(res);
      await sendDetail(req, res, { error: parsed.error }, 400);
      return;
    }

    const password = await secretStore.getSecretVersion(
      subscriptionSecretId(req.params.id),
      parsed.version ?? LATEST_VERSION,
    );
    if (password === null) {
      // The flag and the secret have drifted — say so rather than showing an
      // empty box, since it means the stored secret is gone.
      noStore(res);
      await sendDetail(
        req,
        res,
        {
          error: parsed.version
            ? "That stored password couldn't be read. It may have been destroyed in Secret Manager."
            : "The stored password couldn't be found. Ask an admin to set it again.",
        },
        500,
      );
      return;
    }

    await subscriptionsRepo.logReveal(req.params.id, realEmail(req), "password", parsed.version);
    noStore(res);
    await sendDetail(req, res, { password, passwordVersion: parsed.version });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ mail ------------------------------ */

subscriptionsRouter.post("/subscriptions/:id/mail", async (req, res, next) => {
  try {
    const subscription = await loadForWrite(req, res);
    if (!subscription) return;

    if (!isFamilyMailbox(subscription.accountEmail)) {
      res.status(400).send("This subscription isn't registered to the family mailbox.");
      return;
    }
    if (!subscription.mailFrom) {
      res.status(400).send("No mail sender is set for this subscription.");
      return;
    }

    noStore(res);

    try {
      const mail = await mailbox.readServiceMail(subscription.mailFrom);
      // Logged only once the read succeeded: an audit trail that records a
      // timed-out attempt as "read the mail" misreports what happened.
      await subscriptionsRepo.logReveal(req.params.id, realEmail(req), "mail");
      await sendDetail(req, res, { mail });
    } catch (err) {
      // An IMAP failure is ordinary (timeout, rotated app password) and
      // shouldn't take the page down. The reason never reaches the page:
      // it can carry the mailbox address and server detail.
      console.error("Failed to search the family mailbox:", err);
      await sendDetail(req, res, {
        warning: "Couldn't reach the family mailbox just now. Try again in a moment.",
        mail: [],
      });
    }
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- delete ----------------------------- */

subscriptionsRouter.post("/subscriptions/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    if (!(await loadForWrite(req, res))) return;

    await subscriptionsRepo.deleteSubscription(req.params.id);
    try {
      // After the Firestore delete, deliberately: the doc is the record the
      // rest of the app reads, and it must not survive a Secret Manager
      // hiccup. Same ordering rationale as deleteUser's IAP revoke.
      await secretStore.deleteSecret(subscriptionSecretId(req.params.id));
    } catch (err) {
      console.error(`Failed to delete the stored password for ${req.params.id}:`, err);
    }
    res.redirect("/subscriptions");
  } catch (err) {
    next(err);
  }
});
