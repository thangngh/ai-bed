export interface AdminFeedbackItem {
  feedback_id: string;
  /** SQLite format `YYYY-MM-DD HH:MM:SS` in UTC -- not ISO 8601. */
  created_at: string | null;
  rating: number | null;
  listened_complete: number | null;
  wants_more: number | null;
  suitable: number | null;
  note: string | null;
  story_id: string;
  /** null when the story is no longer in local.db. Not an error. */
  story_title: string | null;
  /** null when the feedback was not tied to a child. Not an error. */
  child_name: string | null;
  tenant_id: string;
}

export interface AdminFeedbackPage {
  items: AdminFeedbackItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface LoginResponse {
  token: string;
  expires_at: string;
  admin: { admin_id: string; username: string };
}

export interface FeedbackFilterState {
  rating: string;
  hasNote: string;
  from: string;
  to: string;
}
