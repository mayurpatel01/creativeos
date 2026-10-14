"use server";

import { DESIGN_BUCKET, designObjectUrl, designStoragePath } from "@/lib/design-storage";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ASSIGNMENT_STATUS_LABELS,
  DESIGNER_STATUSES,
  isLockedStatus,
  type DesignerStatus,
} from "./statuses";

export type SaveResult = { ok: true } | { ok: false; error: string };

const MAX_FILENAME_LENGTH = 255;

function lockedMessage(status: keyof typeof ASSIGNMENT_STATUS_LABELS): string {
  return `This design is ${ASSIGNMENT_STATUS_LABELS[status].toLowerCase()} and can't be edited.`;
}

// The token is the only auth, so every save re-checks that it belongs to an
// active designer who owns this assignment.
async function getOwnedAssignment(token: string, assignmentId: string) {
  const supabase = getSupabaseAdmin();

  const { data: designer, error: designerError } = await supabase
    .from("designers")
    .select("id")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  if (designerError) {
    console.error("[designer portal] designer lookup failed:", designerError);
    return null;
  }
  if (!designer) {
    console.log("[designer portal] no active designer for token", {
      tokenLength: token.length,
      assignmentId,
    });
    return null;
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, asset_id, status")
    .eq("id", assignmentId)
    .eq("designer_id", designer.id)
    .maybeSingle();
  if (assignmentError) {
    console.error("[designer portal] assignment lookup failed:", assignmentError);
    return null;
  }

  if (!assignment) {
    // Look the row up by id alone to see whether it's missing or owned by someone else.
    const { data: actual } = await supabase
      .from("assignments")
      .select("asset_id, designer_id")
      .eq("id", assignmentId)
      .maybeSingle();
    console.log("[designer portal] assignment not found", {
      designerId: designer.id,
      assignmentId,
      assetId: actual?.asset_id ?? null,
      assignmentDesignerId: actual?.designer_id ?? null,
      reason: !actual
        ? "no assignment row with this id (deleted, or page is stale)"
        : "assignment belongs to a different designer (reassigned)",
    });
  }

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
  if (isLockedStatus(assignment.status)) {
    return { ok: false, error: lockedMessage(assignment.status) };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await getSupabaseAdmin()
    .from("assignments")
    .update({
      status,
      submitted_at: status === "submitted" ? now : null,
      updated_at: now,
    })
    .eq("id", assignment.id)
    .select("id");

  if (error) {
    // A status CHECK constraint violation lands here with Postgres code 23514.
    console.error("[designer portal] status update failed:", { status, error });
    return { ok: false, error: error.message };
  }
  if (!updated?.length) {
    console.error("[designer portal] status update matched no rows", {
      assignmentId: assignment.id,
      status,
    });
    return { ok: false, error: "Couldn't save the status. Reload the page and try again." };
  }
  return { ok: true };
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
  if (isLockedStatus(assignment.status)) {
    return { ok: false, error: lockedMessage(assignment.status) };
  }

  // assignments has no filename column, so this lives on assets.designer_filename.
  const { error } = await getSupabaseAdmin()
    .from("assets")
    .update({ designer_filename: value || null, updated_at: new Date().toISOString() })
    .eq("id", assignment.asset_id);

  return error ? { ok: false, error: error.message } : { ok: true };
}

const MAX_DIMENSION = 20000;

// Called after the browser has uploaded the PNG to storage. Records the file on the
// asset and marks the assignment submitted.
export async function saveFileUrl(
  token: string,
  assetId: string,
  fileUrl: string,
  width: number,
  height: number,
): Promise<SaveResult> {
  if (
    ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= MAX_DIMENSION)
  ) {
    return { ok: false, error: "Invalid image dimensions." };
  }

  const supabase = getSupabaseAdmin();

  const { data: designer } = await supabase
    .from("designers")
    .select("id")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  if (!designer) return { ok: false, error: "Assignment not found." };

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, status")
    .eq("asset_id", assetId)
    .eq("designer_id", designer.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (assignmentError) {
    console.error("[designer portal] upload assignment lookup failed:", assignmentError);
  }
  if (!assignment) {
    console.log("[designer portal] upload: no assignment", { designerId: designer.id, assetId });
    return { ok: false, error: "Assignment not found." };
  }
  if (isLockedStatus(assignment.status)) {
    return { ok: false, error: lockedMessage(assignment.status) };
  }

  const { data: asset } = await supabase
    .from("assets")
    .select("god, suggested_filename")
    .eq("id", assetId)
    .single();
  if (!asset?.god || !asset.suggested_filename) {
    return { ok: false, error: "This design is missing its god or filename." };
  }

  // Only accept the URL this asset's file is supposed to live at.
  const filePath = designStoragePath(asset.god, asset.suggested_filename);
  const expectedUrl = designObjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, filePath);
  if (fileUrl !== expectedUrl) {
    console.error("[designer portal] upload URL mismatch", { assetId, fileUrl, expectedUrl });
    return { ok: false, error: "Upload location doesn't match this design." };
  }

  const { data: objects, error: listError } = await supabase.storage
    .from(DESIGN_BUCKET)
    .list(`designs/${asset.god}`, { search: asset.suggested_filename });
  if (listError || !objects?.some((o) => o.name === asset.suggested_filename)) {
    console.error("[designer portal] uploaded file not found in storage", { filePath, listError });
    return { ok: false, error: "The upload didn't reach storage. Try again." };
  }

  const now = new Date().toISOString();
  const { error: assetError } = await supabase
    .from("assets")
    .update({
      file_url: fileUrl,
      file_path: filePath,
      file_type: "image/png",
      resolution_width: width,
      resolution_height: height,
      updated_at: now,
    })
    .eq("id", assetId);
  if (assetError) return { ok: false, error: assetError.message };

  const { error: statusError } = await supabase
    .from("assignments")
    .update({ status: "submitted", submitted_at: now, updated_at: now })
    .eq("id", assignment.id);
  if (statusError) {
    console.error("[designer portal] submit after upload failed:", statusError);
    return { ok: false, error: `File saved, but the status didn't update: ${statusError.message}` };
  }

  return { ok: true };
}
