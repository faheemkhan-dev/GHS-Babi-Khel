import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { uploadToCloudinary } from "@/lib/cloudinary";

export type AdmissionType   = "fresh" | "migration";
export type AdmissionStatus =
  | "pending" | "under_review" | "approved" | "rejected" | "documents_missing"
  | "documents_verified" | "interview_scheduled" | "interview_completed"
  | "waitlisted" | "admitted" | "admit_card_issued";

/**
 * Normalize a phone number to digit-only form (preserving a leading +).
 * Used everywhere we compare or store phone numbers, so "0301-1234567",
 * "0301 1234567", "+92 301 1234567", and "03011234567" all collapse to
 * the same key. Mirrors the SQL `normalize_phone()` function.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/[^0-9+]/g, "");
}

export interface AdmissionSettings {
  id: number; is_open: boolean; session_year: string;
  open_date: string | null; last_date: string | null;
  banner_message: string | null; notes: string | null; updated_at: string;
}

export interface Admission {
  id: string; reference_no: string; full_name: string; father_name: string;
  date_of_birth: string | null; b_form_no: string; contact_number: string;
  whatsapp_number: string | null; home_address: string | null; gender: string | null;
  applying_class: string; admission_type: AdmissionType; previous_school: string | null;
  previous_class: string | null; previous_marks: string | null; year_of_passing: string | null;
  status: AdmissionStatus; admin_note: string | null; rejection_reason: string | null;
  admission_roll_no: string | null; migration_step: number | null;
  created_at: string; updated_at: string;
}

export interface AdmissionDocument {
  id: string; admission_id: string; doc_type: string;
  file_path: string; file_name: string | null; uploaded_at: string;
}

export interface AdmissionPayload {
  full_name: string;
  father_name: string;
  date_of_birth: string | null;
  b_form_no: string;
  contact_number: string;
  whatsapp_number: string | null;
  home_address: string | null;
  gender: string | null;
  applying_class: string;
  admission_type: AdmissionType;
  previous_school: string | null;
  previous_class: string | null;
  previous_marks: string | null;
  year_of_passing: string | null;
}

export interface AdmissionDocumentPayload {
  doc_type: string;
  file_path: string;
  file_name: string | null;
}

const ADMISSION_FIELDS = "id, reference_no, full_name, father_name, date_of_birth, b_form_no, contact_number, whatsapp_number, home_address, gender, applying_class, admission_type, previous_school, previous_class, previous_marks, year_of_passing, status, admin_note, rejection_reason, admission_roll_no, migration_step, created_at, updated_at";
const ADMISSION_DOCUMENT_FIELDS = "id, admission_id, doc_type, file_path, file_name, uploaded_at";

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s. Check your internet and try again.`)),
      ms
    );

    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); }
    );
  });
}

function isMissingRpcError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("submit_admission_public") || message.includes("PGRST202") || message.includes("Could not find the function");
}

function createFallbackReferenceNo() {
  const year = new Date().getFullYear();
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  return `OHS-${year}-${suffix}`;
}

export function useAdmissionSettings() {
  return useQuery<AdmissionSettings | null>({
    queryKey: ["admission-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admission_settings")
        .select("id, is_open, session_year, open_date, last_date, banner_message, notes, updated_at")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useTrackAdmission(query: string) {
  return useQuery({
    queryKey: ["track-admission", query],
    queryFn: async () => {
      // SECURITY (migration 20260825000001_014_secure_pii_rls.sql):
      // The admissions table is no longer readable by anonymous visitors —
      // only (id, reference_no) remain public so the submit form can return
      // its reference number. The public Application Tracker therefore goes
      // EXCLUSIVELY through the hardened `track_admission` RPC, which:
      //   • accepts ALL lookup keys (reference_no, b_form_no,
      //     contact_number, whatsapp_number, admission_roll_no),
      //   • returns full rows ONLY for exact case-insensitive matches,
      //   • can never be used to list applications (no wildcards).
      const { data, error } = await supabase.rpc("track_admission", {
        p_query: query.trim(),
      });
      if (error) throw error;
      return (data ?? []) as Admission[];
    },
    enabled: query.length >= 5,
    staleTime: 0,
    // Don't carry over a previous search's results while a new search is
    // in flight — without this, the old result card and the "Searching…"
    // spinner render at the same time, which looks broken/fake.
    placeholderData: undefined,
    gcTime: 0,
  });
}

const PAGE_SIZE = 20;
export function useAdminAdmissions(filters: {
  status?: string; classFilter?: string; typeFilter?: string; page?: number;
} = {}) {
  const page = filters.page ?? 0;
  return useQuery<{ admissions: Admission[]; count: number }>({
    queryKey: ["admin-admissions", filters],
    queryFn: async () => {
      let q = supabase.from("admissions").select(ADMISSION_FIELDS, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.classFilter && filters.classFilter !== "all") q = q.eq("applying_class", filters.classFilter);
      if (filters.typeFilter && filters.typeFilter !== "all") q = q.eq("admission_type", filters.typeFilter);
      const { data, error, count } = await q;
      if (error) throw error;
      return { admissions: (data ?? []) as Admission[], count: count ?? 0 };
    },
  });
}

export function useAdmissionDocuments(admissionId: string) {
  return useQuery<AdmissionDocument[]>({
    queryKey: ["admission-docs", admissionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("admission_documents")
        .select(ADMISSION_DOCUMENT_FIELDS).eq("admission_id", admissionId).order("uploaded_at");
      if (error) throw error;
      return (data ?? []) as AdmissionDocument[];
    },
    enabled: !!admissionId,
  });
}

export function useUpdateAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Admission> }) => {
      const { error } = await supabase.from("admissions").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-admissions"] }),
  });
}

/**
 * Preferred way for the admin to change an applicant's status.
 *
 * Calls the `update_admission_status` RPC which atomically:
 *   1. Updates the admissions row
 *   2. Inserts a row into admission_status_timeline (so the applicant sees
 *      the change in their portal)
 *   3. Sends the applicant an SMS notification (via notify_applicant_sms)
 *   4. Auto-promotes the next waitlisted applicant when a seat frees up
 *
 * Always prefer this over `useUpdateAdmission` when the `status` field is
 * changing — direct table updates skip timeline + notifications entirely.
 */
export function useUpdateAdmissionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      newStatus,
      note,
    }: {
      id: string;
      newStatus: AdmissionStatus;
      note?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("update_admission_status", {
        p_admission_id: id,
        p_new_status:   newStatus,
        p_note:         note ?? null,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to update status");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-admissions"] });
      qc.invalidateQueries({ queryKey: ["admission-docs"] });
    },
  });
}

export function useDeleteAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // First delete associated documents
      const { error: docsError } = await supabase
        .from("admission_documents")
        .delete()
        .eq("admission_id", id);
      if (docsError) throw docsError;
      // Then delete the admission
      const { error } = await supabase.from("admissions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-admissions"] });
      qc.invalidateQueries({ queryKey: ["admission-docs"] });
    },
  });
}

export function useUpdateAdmissionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<AdmissionSettings>) => {
      const { error } = await supabase.from("admission_settings")
        .update({ ...updates, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admission-settings"] }),
  });
}

// Submits the admission form and its already-uploaded Cloudinary document URLs.
export async function submitAdmission(
  payload: AdmissionPayload,
  documents: AdmissionDocumentPayload[] = []
): Promise<{ id: string; reference_no: string }> {
  // Normalize phone numbers before submit so the applicant can later log
  // in to the portal with ANY formatting (with/without dashes, spaces, +92
  // vs 0 prefix) and still match. Mirrors the SQL `normalize_phone()`.
  const rpcParams = {
    p_full_name:       payload.full_name,
    p_father_name:     payload.father_name,
    p_date_of_birth:   payload.date_of_birth || null,
    p_b_form_no:       payload.b_form_no,
    p_contact_number:  normalizePhone(payload.contact_number),
    p_whatsapp_number: normalizePhone(payload.whatsapp_number) || null,
    p_home_address:    payload.home_address ?? null,
    p_gender:          payload.gender ?? null,
    p_applying_class:  payload.applying_class,
    p_admission_type:  payload.admission_type,
    p_previous_school: payload.previous_school ?? null,
    p_previous_class:  payload.previous_class ?? null,
    p_previous_marks:  payload.previous_marks ?? null,
    p_year_of_passing: payload.year_of_passing ?? null,
    p_documents:       documents,
  };

  try {
    const { data, error } = await withTimeout(
      supabase.rpc("submit_admission_public", rpcParams),
      25000,
      "Admission submission"
    );
    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id || !row?.reference_no) throw new Error("No response from server. Please try again.");
    return { id: row.id, reference_no: row.reference_no };
  } catch (error) {
    // No insecure direct-insert fallback — always require the validated RPC.
    // If the RPC is missing (PGRST202), surface a clear setup error instead of
    // bypassing server-side duplicate-prevention and field validation.
    if (isMissingRpcError(error)) {
      throw new Error(
        "Admission service is not configured correctly. Please contact the school administrator."
      );
    }
    throw new Error(`Submission failed: ${error instanceof Error ? error.message : "Please try again."}`);
  }
}

// Uploads a single document to Cloudinary then records it in Supabase
export async function uploadAdmissionDocument(
  admissionId: string,
  docType: string,
  file: File
): Promise<string> {
  const cloudinaryUrl = await uploadToCloudinary(file, `admissions/${admissionId}`);
  const { error } = await supabase.from("admission_documents").insert({
    admission_id: admissionId,
    doc_type:     docType,
    file_path:    cloudinaryUrl,
    file_name:    file.name,
  });
  if (error) throw new Error(`Failed to record document: ${error.message}`);
  return cloudinaryUrl;
}

export function getDocUrl(path: string): string {
  return path;
    }
    
