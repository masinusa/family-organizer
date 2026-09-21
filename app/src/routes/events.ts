import { Router } from "express";
import * as eventsRepo from "../lib/events-repo.js";
import { render } from "../lib/render.js";
import type { EventDoc, EventInput } from "../lib/types.js";

export const eventsRouter = Router();

interface FormValues {
  id: string | null;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a Date as the value a <input type="datetime-local"> expects, in local time. */
function toDatetimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formValuesFromEvent(event: EventDoc): FormValues {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? "",
    startAt: toDatetimeLocal(event.startAt),
    endAt: toDatetimeLocal(event.endAt),
    allDay: event.allDay,
    location: event.location ?? "",
  };
}

function formValuesFromBody(body: Record<string, unknown>, id: string | null): FormValues {
  return {
    id,
    title: typeof body.title === "string" ? body.title : "",
    description: typeof body.description === "string" ? body.description : "",
    startAt: typeof body.startAt === "string" ? body.startAt : "",
    endAt: typeof body.endAt === "string" ? body.endAt : "",
    allDay: body.allDay === "on",
    location: typeof body.location === "string" ? body.location : "",
  };
}

function parseEventInput(values: FormValues): EventInput | { error: string } {
  const title = values.title.trim();
  if (!title) {
    return { error: "Title is required." };
  }

  const startAt = new Date(values.startAt);
  const endAt = new Date(values.endAt);
  if (!values.startAt || Number.isNaN(startAt.getTime())) {
    return { error: "A valid start time is required." };
  }
  if (!values.endAt || Number.isNaN(endAt.getTime())) {
    return { error: "A valid end time is required." };
  }
  if (endAt < startAt) {
    return { error: "End time must not be before start time." };
  }

  return {
    title,
    description: values.description.trim() || null,
    startAt,
    endAt,
    allDay: values.allDay,
    location: values.location.trim() || null,
  };
}

eventsRouter.get("/", async (req, res, next) => {
  try {
    const events = await eventsRepo.listUpcoming();
    res.send(render("events-list", { events, email: req.user?.email }));
  } catch (err) {
    next(err);
  }
});

eventsRouter.get("/events/new", (_req, res) => {
  res.send(
    render("event-form", {
      values: formValuesFromBody({}, null),
      error: null,
    }),
  );
});

eventsRouter.post("/events", async (req, res, next) => {
  try {
    const values = formValuesFromBody(req.body, null);
    const parsed = parseEventInput(values);
    if ("error" in parsed) {
      res.status(400).send(render("event-form", { values, error: parsed.error }));
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
    const result = await eventsRepo.getWithAttendees(req.params.id);
    if (!result) {
      res.status(404).send("Event not found");
      return;
    }
    res.send(render("event-detail", { ...result, email: req.user?.email }));
  } catch (err) {
    next(err);
  }
});

eventsRouter.get("/events/:id/edit", async (req, res, next) => {
  try {
    const result = await eventsRepo.getWithAttendees(req.params.id);
    if (!result) {
      res.status(404).send("Event not found");
      return;
    }
    res.send(
      render("event-form", {
        values: formValuesFromEvent(result.event),
        error: null,
      }),
    );
  } catch (err) {
    next(err);
  }
});

eventsRouter.post("/events/:id", async (req, res, next) => {
  try {
    const values = formValuesFromBody(req.body, req.params.id);
    const parsed = parseEventInput(values);
    if ("error" in parsed) {
      res.status(400).send(render("event-form", { values, error: parsed.error }));
      return;
    }
    await eventsRepo.update(req.params.id, parsed);
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
