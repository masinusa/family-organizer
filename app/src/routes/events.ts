import { Router, type Request } from "express";
import { parseMonthQuery, renderCalendarPage } from "../lib/calendar-page.js";
import { listCategories, makeChipLookup, toChip } from "../lib/categories.js";
import { eventFieldsData } from "../lib/event-fields.js";
import {
  RSVP_LABELS,
  RSVP_STATUSES,
  blankFormValues,
  formValuesFromBody,
  formValuesFromEvent,
  formatEventWhen,
  groupAttendees,
  parseEventInput,
  type FormValues,
} from "../lib/event-input.js";
import * as eventsRepo from "../lib/events-repo.js";
import { render } from "../lib/render.js";
import { avatarFor } from "../lib/people.js";
import * as usersRepo from "../lib/users-repo.js";
import { isAdmin } from "../middleware/access-control.js";
import type { RsvpStatus } from "../lib/types.js";

export const eventsRouter = Router();

/** The bits every page needs for the nav bar. */
function chrome(req: Request): Record<string, unknown> {
  return { email: req.user?.email, isAdmin: isAdmin(req), active: "calendar" };
}

async function renderForm(req: Request, values: FormValues, error: string | null): Promise<string> {
  const [members, categories] = await Promise.all([usersRepo.listUsers(), listCategories()]);
  return render("event-form", {
    ...eventFieldsData(values, members, categories.map(toChip)),
    error,
    ...chrome(req),
  });
}

/**
 * Loads the member list and category ids the submission has to be validated
 * against, then parses. Both reads are needed whether or not it validates,
 * since a failed parse re-renders the same form.
 */
async function parseSubmission(
  body: Record<string, unknown>,
  id: string | null,
): Promise<{ values: FormValues; parsed: ReturnType<typeof parseEventInput> }> {
  const [members, categories] = await Promise.all([usersRepo.listUsers(), listCategories()]);
  const values = formValuesFromBody(
    body,
    id,
    members.map((member) => member.email),
  );
  return { values, parsed: parseEventInput(values, categories.map((c) => c.id)) };
}

eventsRouter.get("/", async (req, res, next) => {
  try {
    res.send(await renderCalendarPage(req, parseMonthQuery(req.query)));
  } catch (err) {
    next(err);
  }
});

eventsRouter.get("/events/new", async (req, res, next) => {
  try {
    const members = await usersRepo.listUsers();
    // Where a day cell lands when JavaScript isn't available to open the
    // quick-add modal in place.
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const values = blankFormValues(
      members.map((member) => member.email),
      date,
    );
    res.send(await renderForm(req, values, null));
  } catch (err) {
    next(err);
  }
});

eventsRouter.post("/events", async (req, res, next) => {
  try {
    const { values, parsed } = await parseSubmission(req.body, null);
    if ("error" in parsed) {
      res.status(400).send(await renderForm(req, values, parsed.error));
      return;
    }
    const id = await eventsRepo.create(parsed, req.user!.email);
    res.redirect(`/events/${id}`);
  } catch (err) {
    next(err);
  }
});

eventsRouter.get("/events/:id", async (req, res, next) => {
  try {
    const [event, categories] = await Promise.all([
      eventsRepo.get(req.params.id),
      listCategories(),
    ]);
    if (!event) {
      res.status(404).send("Event not found");
      return;
    }
    const chipFor = makeChipLookup(categories);
    const you = event.attendees.find((a) => a.email === req.user?.email);
    res.send(
      render("event-detail", {
        event,
        when: formatEventWhen(event),
        category: event.categoryId ? chipFor(event.categoryId) : null,
        groups: groupAttendees(event.attendees).map((group) => ({
          ...group,
          faces: group.people.map(avatarFor),
        })),
        yourStatus: you?.status ?? null,
        statuses: RSVP_STATUSES.map((status) => ({ value: status, label: RSVP_LABELS[status] })),
        ...chrome(req),
      }),
    );
  } catch (err) {
    next(err);
  }
});

eventsRouter.get("/events/:id/edit", async (req, res, next) => {
  try {
    const event = await eventsRepo.get(req.params.id);
    if (!event) {
      res.status(404).send("Event not found");
      return;
    }
    res.send(await renderForm(req, formValuesFromEvent(event), null));
  } catch (err) {
    next(err);
  }
});

eventsRouter.post("/events/:id", async (req, res, next) => {
  try {
    const { values, parsed } = await parseSubmission(req.body, req.params.id);
    if ("error" in parsed) {
      res.status(400).send(await renderForm(req, values, parsed.error));
      return;
    }
    await eventsRepo.update(req.params.id, parsed);
    res.redirect(`/events/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

/**
 * One-tap response from the event page. Deliberately only ever writes the
 * caller's own status — the email comes from the verified IAP identity, not
 * from the form — so nobody can answer on someone else's behalf. Changing
 * other people's responses is what the edit form is for.
 */
eventsRouter.post("/events/:id/rsvp", async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!RSVP_STATUSES.includes(status)) {
      res.status(400).send("Invalid response");
      return;
    }
    const found = await eventsRepo.setAttendeeStatus(
      req.params.id,
      req.user!.email,
      status as RsvpStatus,
    );
    if (!found) {
      res.status(404).send("Event not found");
      return;
    }
    res.redirect(`/events/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

eventsRouter.post("/events/:id/delete", async (req, res, next) => {
  try {
    await eventsRepo.deleteEvent(req.params.id);
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});
