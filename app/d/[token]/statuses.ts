export const ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "submitted",
  "approved",
  "rejected",
  "cancelled",
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// Designers can only move between these; the rest are set by the admin.
export const DESIGNER_STATUSES = ["assigned", "in_progress", "submitted"] as const;

export type DesignerStatus = (typeof DESIGNER_STATUSES)[number];

// Rows in these statuses are read-only for the designer.
export const LOCKED_STATUSES = ["approved", "rejected", "cancelled"] as const;

export type LockedStatus = (typeof LOCKED_STATUSES)[number];

export function isLockedStatus(status: string): status is LockedStatus {
  return (LOCKED_STATUSES as readonly string[]).includes(status);
}

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
