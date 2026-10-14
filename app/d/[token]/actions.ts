"use server";

import { getSupabaseAdmin } from "@/lib/supabase";
import { DESIGNER_STATUSES, type DesignerStatus } from "./statuses";

export type SaveResult = { ok: true } | { ok: false; error: string };

const MAX_FILENAME_LENGTH = 255;

// The token is the only auth, so every save re-checks that it belongs to an
// active designer who owns this assignment.
async function getOwnedAssignment(token: string, assignmentId: string) {
  const supabase = getSupabaseAdmin();

  const { data: designer } = await supabase
    .from("designers")
    .select("id")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  if (!designer) return null;

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, asset_id, status")
    .eq("id", assignmentId)
    .eq("designer_id", designer.id)
    .maybeSingle();
  return assignment;
}

export async function saveAssignmentStatus(
  token: string,
  assignmentId: string,
  status: DesignerStatus,
): Promise<SaveResult> {
  if (!DESIGNER_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status." };
  }

  const assignment = await getOwnedAssignment(token, assignmentId);
  if (!assignment) return { ok: false, error: "Assignment not found." };
  if (assignment.status === "approved") {
    return { ok: false, error: "This design is already approved." };
  }

  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("assignments")
    .update({
      status,
      submitted_at: status === "submitted" ? now : null,
      updated_at: now,
    })
    .eq("id", assignment.id);

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function saveDesignerFilename(
  token: string,
  assignmentId: string,
  filename: string,
): Promise<SaveResult> {
  const value = filename.trim();
  if (value.length > MAX_FILENAME_LENGTH) {
    return { ok: false, error: `Keep it under ${MAX_FILENAME_LENGTH} characters.` };
  }

  const assignment = await getOwnedAssignment(token, assignmentId);
  if (!assignment) return { ok: false, error: "Assignment not found." };
  if (assignment.status === "approved") {
    return { ok: false, error: "This design is already approved." };
  }

  // assignments has no filename column, so this lives on assets.designer_filename.
  const { error } = await getSupabaseAdmin()
    .from("assets")
    .update({ designer_filename: value || null, updated_at: new Date().toISOString() })
    .eq("id", assignment.asset_id);

  return error ? { ok: false, error: error.message } : { ok: true };
}
