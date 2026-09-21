import { Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import type { AttendeeDoc, EventDoc, EventInput, ResponseStatus } from "./types.js";

const eventsCollection = () => firestore.collection("events");

function toEventDoc(id: string, data: DocumentData): EventDoc {
  return {
    id,
    title: data.title,
    description: data.description ?? null,
    startAt: (data.startAt as Timestamp).toDate(),
    endAt: (data.endAt as Timestamp).toDate(),
    allDay: Boolean(data.allDay),
    location: data.location ?? null,
    recurrenceRule: data.recurrenceRule ?? null,
    createdBy: data.createdBy,
    createdAt: (data.createdAt as Timestamp).toDate(),
    updatedAt: (data.updatedAt as Timestamp).toDate(),
  };
}

function toAttendeeDoc(id: string, data: DocumentData): AttendeeDoc {
  return {
    id,
    userEmail: data.userEmail,
    responseStatus: data.responseStatus,
    isOrganizer: Boolean(data.isOrganizer),
  };
}

export async function listUpcoming(limit = 50): Promise<EventDoc[]> {
  const snapshot = await eventsCollection()
    .where("startAt", ">=", Timestamp.now())
    .orderBy("startAt")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => toEventDoc(doc.id, doc.data()));
}

export async function getWithAttendees(
  eventId: string,
): Promise<{ event: EventDoc; attendees: AttendeeDoc[] } | null> {
  const eventRef = eventsCollection().doc(eventId);
  const [eventSnap, attendeesSnap] = await Promise.all([
    eventRef.get(),
    eventRef.collection("attendees").get(),
  ]);
  if (!eventSnap.exists) {
    return null;
  }
  return {
    event: toEventDoc(eventSnap.id, eventSnap.data()!),
    attendees: attendeesSnap.docs.map((doc) => toAttendeeDoc(doc.id, doc.data())),
  };
}

/** Creates the event and the creator's own organizer/accepted attendee record atomically. */
export async function create(input: EventInput, createdBy: string): Promise<string> {
  const eventRef = eventsCollection().doc();
  const now = Timestamp.now();
  const batch = firestore.batch();

  batch.set(eventRef, {
    title: input.title,
    description: input.description,
    startAt: Timestamp.fromDate(input.startAt),
    endAt: Timestamp.fromDate(input.endAt),
    allDay: input.allDay,
    location: input.location,
    recurrenceRule: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(eventRef.collection("attendees").doc(), {
    userEmail: createdBy,
    responseStatus: "accepted" satisfies ResponseStatus,
    isOrganizer: true,
  });

  await batch.commit();
  return eventRef.id;
}

export async function update(eventId: string, input: EventInput): Promise<void> {
  await eventsCollection().doc(eventId).update({
    title: input.title,
    description: input.description,
    startAt: Timestamp.fromDate(input.startAt),
    endAt: Timestamp.fromDate(input.endAt),
    allDay: input.allDay,
    location: input.location,
    updatedAt: Timestamp.now(),
  });
}

/** Firestore doesn't cascade-delete subcollections, so attendees are deleted explicitly. */
export async function deleteEvent(eventId: string): Promise<void> {
  const eventRef = eventsCollection().doc(eventId);
  const attendeesSnap = await eventRef.collection("attendees").get();

  const batch = firestore.batch();
  attendeesSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(eventRef);
  await batch.commit();
}

/** No per-event ACLs (docs/threat-model.md) — any authenticated family member may RSVP to any event. */
export async function setRsvp(
  eventId: string,
  userEmail: string,
  responseStatus: ResponseStatus,
): Promise<void> {
  const attendeesRef = eventsCollection().doc(eventId).collection("attendees");
  const existing = await attendeesRef.where("userEmail", "==", userEmail).limit(1).get();

  if (existing.empty) {
    await attendeesRef.add({ userEmail, responseStatus, isOrganizer: false });
  } else {
    await existing.docs[0]!.ref.update({ responseStatus });
  }
}
