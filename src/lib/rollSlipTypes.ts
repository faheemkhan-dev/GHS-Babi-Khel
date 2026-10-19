export interface ExamSession {
  id: string; title: string; exam_year: number; exam_term: string;
  classes: string[]; class_order: string[]; starting_number: number;
  is_published: boolean; publish_at: string | null;
  countdown_label: string | null; created_at: string;
}

export interface RollEntry {
  id: string; student_id: string; student_name: string; father_name: string | null;
  class: string; class_roll_no: string; exam_roll_no: string; serial_number: number;
}

export const SLIP_INSTRUCTIONS = [
  "1. Bring this Roll No Slip to the exam center for every paper.",
  "2. No slip, no entry to the examination hall.",
  "3. Do not bring mobile phones, smart watches, or any electronic device to the exam hall.",
  "4. Do not fold, scratch, or damage the QR code — it must scan cleanly for attendance.",
  "5. Report any errors or omissions on this slip before the exam begins.",
  "6. Reach the exam center at least 30 minutes before the paper starts.",
];
