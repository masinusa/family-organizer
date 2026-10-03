export interface EventDoc {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
  recurrenceRule: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventInput {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
}

export type UserRole = "admin" | "member";

export interface UserDoc {
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type FeedbackCategory = "general" | "bug" | "idea";
export type FeedbackStatus = "new" | "reviewed" | "resolved";

export interface FeedbackInput {
  message: string;
  category: FeedbackCategory;
}

export interface FeedbackDoc extends FeedbackInput {
  id: string;
  submittedBy: string;
  status: FeedbackStatus;
  createdAt: Date;
  updatedAt: Date;
}
