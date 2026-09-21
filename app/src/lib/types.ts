export type ResponseStatus = "needs_action" | "accepted" | "declined" | "tentative";

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

export interface AttendeeDoc {
  id: string;
  userEmail: string;
  responseStatus: ResponseStatus;
  isOrganizer: boolean;
}

export interface EventInput {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
}
