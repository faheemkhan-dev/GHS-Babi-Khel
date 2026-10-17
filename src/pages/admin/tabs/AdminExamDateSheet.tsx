// src/pages/admin/tabs/AdminExamDateSheet.tsx
// Standalone page for the "Exam Date Sheet" sidebar item. No shared "Exams" header,
// no pill toggle to the other two exam features — this is its own page, matching
// how "Manage Students", "Manage Results" etc. are each their own page.

import AdminExamSchedule from "./AdminExamSchedule";

const AdminExamDateSheet = () => <AdminExamSchedule />;

export default AdminExamDateSheet;
