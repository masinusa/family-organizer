import { Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import type { FeedbackDoc, FeedbackInput, FeedbackStatus } from "./types.js";

const feedbackCollection = () => firestore.collection("feedback");

function toFeedbackDoc(id: string, data: DocumentData): FeedbackDoc {
  return {
    id,
    message: data.message,
    category: data.category,
    submittedBy: data.submittedBy,
    status: data.status,
    createdAt: (data.createdAt as Timestamp).toDate(),
    updatedAt: (data.updatedAt as Timestamp).toDate(),
  };
}

export async function create(input: FeedbackInput, submittedBy: string): Promise<string> {
  const now = Timestamp.now();
  const feedbackRef = await feedbackCollection().add({
    message: input.message,
    category: input.category,
    submittedBy,
    status: "new",
    createdAt: now,
    updatedAt: now,
  });
  return feedbackRef.id;
}

export async function list(limit = 100): Promise<FeedbackDoc[]> {
  const snapshot = await feedbackCollection().orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map((doc) => toFeedbackDoc(doc.id, doc.data()));
}

export async function updateStatus(feedbackId: string, status: FeedbackStatus): Promise<void> {
  await feedbackCollection().doc(feedbackId).update({ status, updatedAt: Timestamp.now() });
}
