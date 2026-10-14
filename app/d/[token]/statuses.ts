export const ASSIGNMENT_STATUSES = ["assigned", "in_progress", "submitted", "approved"] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// "approved" is set by the admin; designers can only move between these.
export const DESIGNER_STATUSES = ["assigned", "in_progress", "submitted"] as const;

export type DesignerStatus = (typeof DESIGNER_STATUSES)[number];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted",
  approved: "Approved",
};
