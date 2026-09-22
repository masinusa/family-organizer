import { Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import type { EventDoc, EventInput } from "./types.js";

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

export async function listUpcoming(limit = 50): Promise<EventDoc[]> {
  const snapshot = await eventsCollection()
    .where("startAt", ">=", Timestamp.now())
    .orderBy("startAt")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => toEventDoc(doc.id, doc.data()));
}

export async function listInRange(start: Date, end: Date): Promise<EventDoc[]> {
  const snapshot = await eventsCollection()
    .where("startAt", ">=", Timestamp.fromDate(start))
    .where("startAt", "<", Timestamp.fromDate(end))
    .orderBy("startAt")
    .get();
  return snapshot.docs.map((doc) => toEventDoc(doc.id, doc.data()));
}

export async function get(eventId: string): Promise<EventDoc | null> {
  const snap = await eventsCollection().doc(eventId).get();
  return snap.exists ? toEventDoc(snap.id, snap.data()!) : null;
}

export async function create(input: EventInput, createdBy: string): Promise<string> {
  const now = Timestamp.now();
  const eventRef = await eventsCollection().add({
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

export async function deleteEvent(eventId: string): Promise<void> {
  await eventsCollection().doc(eventId).delete();
}
