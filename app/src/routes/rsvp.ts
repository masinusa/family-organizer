import { Router } from "express";
import * as eventsRepo from "../lib/events-repo.js";
import type { ResponseStatus } from "../lib/types.js";

export const rsvpRouter = Router();

const VALID_STATUSES: ResponseStatus[] = [
  "needs_action",
  "accepted",
  "declined",
  "tentative",
];

rsvpRouter.post("/events/:id/rsvp", async (req, res, next) => {
  try {
    const status = req.body.responseStatus;
    if (typeof status !== "string" || !VALID_STATUSES.includes(status as ResponseStatus)) {
      res.status(400).send("Invalid RSVP status");
      return;
    }
    await eventsRepo.setRsvp(req.params.id, req.user!.email, status as ResponseStatus);
    res.redirect(`/events/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});
