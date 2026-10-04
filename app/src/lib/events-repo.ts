import { Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import { RSVP_STATUSES } from "./event-input.js";
import type { Attendee, EventDoc, EventInput, RsvpStatus } from "./types.js";

const eventsCollection = () => firestore.collection("events");

function toAttendee(data: DocumentData): Attendee | null {
  const email = typeof data.email === "string" && data.email ? data.email : null;
  const name = typeof data.name === "string" && data.name ? data.name : null;
  if (!email && !name) {
    return null;
  }
  const status: RsvpStatus = RSVP_STATUSES.includes(data.status) ? data.status : "invited";
  return { email, name, status };
}

function toEventDoc(id: string, data: DocumentData): EventDoc {
  const attendees = Array.isArray(data.attendees) ? data.attendees : [];
  return {
    id,
    title: data.title,
    description: data.description ?? null,
    startAt: (data.startAt as Timestamp).toDate(),
    endAt: (data.endAt as Timestamp).toDate(),
    allDay: Boolean(data.allDay),
    location: data.location ?? null,
    // The three fields below post-date the original schema, so events
    // written before them must still read cleanly.
    link: data.link ?? null,
    categoryId: data.categoryId ?? null,
    attendees: attendees.map(toAttendee).filter((a: Attendee | null): a is Attendee => a !== null),
    recurrenceRule: data.recurrenceRule ?? null,
    createdBy: data.createdBy,
    createdAt: (data.createdAt as Timestamp).toDate(),
    updatedAt: (data.updatedAt as Timestamp).toDate(),
  };
}

function toWritableFields(input: EventInput): DocumentData {
  return {
    title: input.title,
    description: input.description,
    startAt: Timestamp.fromDate(input.startAt),
    endAt: Timestamp.fromDate(input.endAt),
    allDay: input.allDay,
    location: input.location,
    link: input.link,
    categoryId: input.categoryId,
    attendees: input.attendees.map((a) => ({ email: a.email, name: a.name, status: a.status })),
  };
}

/**
 * Every event *overlapping* [start, end) — not just those starting inside
 * it, so a trip that began last month still shows on this month's grid.
 *
 * Firestore can't range-filter `startAt` and `endAt` in one query without a
 * composite index (and the ordering constraints that come with it), so only
 * the `startAt` bound is pushed down and the `endAt` bound is applied here.
 * At family-calendar scale that's a handful of docs; revisit if this ever
 * holds thousands of events.
 */
export async function listInRange(start: Date, end: Date): Promise<EventDoc[]> {
  const snapshot = await eventsCollection()
    .where("startAt", "<", Timestamp.fromDate(end))
    .orderBy("startAt")
    .get();
  return snapshot.docs
    .map((doc) => toEventDoc(doc.id, doc.data()))
    .filter((event) => event.endAt >= start);
}

export async function get(eventId: string): Promise<EventDoc | null> {
  const snap = await eventsCollection().doc(eventId).get();
  return snap.exists ? toEventDoc(snap.id, snap.data()!) : null;
}

export async function create(input: EventInput, createdBy: string): Promise<string> {
  const now = Timestamp.now();
  const eventRef = await eventsCollection().add({
    ...toWritableFields(input),
    recurrenceRule: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return eventRef.id;
}

export async function update(eventId: string, input: EventInput): Promise<void> {
  await eventsCollection()
    .doc(eventId)
    .update({ ...toWritableFields(input), updatedAt: Timestamp.now() });
}

/**
 * Sets one family member's own response. Someone who wasn't on the event yet
 * gets added — answering "yes" to a proposed date is how you join it.
 *
 * Read-then-write rather than a transaction: the only writers are family
 * members tapping their own response, and the worst case is one of two
 * simultaneous answers needing a re-tap.
 */
export async function setAttendeeStatus(
  eventId: string,
  email: string,
  status: RsvpStatus,
): Promise<boolean> {
  const ref = eventsCollection().doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) {
    return false;
  }
  const event = toEventDoc(snap.id, snap.data()!);
  const attendees = event.attendees.some((a) => a.email === email)
    ? event.attendees.map((a) => (a.email === email ? { ...a, status } : a))
    : [...event.attendees, { email, name: null, status }];

  await ref.update({
    attendees: attendees.map((a) => ({ email: a.email, name: a.name, status: a.status })),
    updatedAt: Timestamp.now(),
  });
  return true;
}

export async function deleteEvent(eventId: string): Promise<void> {
  await eventsCollection().doc(eventId).delete();
}
