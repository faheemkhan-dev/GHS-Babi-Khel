// src/pages/admin/tabs/AdminExams.tsx
// "Exams" sidebar section — three separate sidebar items (Exam Date Sheet, Exam Roll
// Numbers, Exam Seating) all render this one hub component, which opens on the
// matching sub-tab based on which sidebar item was clicked (?tab=exam-date-sheet /
// exam-rolls / exam-seating). Internally it's a pill toggle, same pattern
// AdminExamSeating already uses for Seating Plans vs Live Console.

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Hash, LayoutGrid, Calendar } from "lucide-react";
import AdminExamRollNumbers from "./AdminExamRollNumbers";
import AdminExamSeating from "./AdminExamSeating";
import AdminExamSchedule from "./AdminExamSchedule";

type ExamTopTab = "rolls" | "seating" | "schedule";

const tabFromUrl = (urlTab: string | null): ExamTopTab => {
  if (urlTab === "exam-rolls") return "rolls";
  if (urlTab === "exam-seating" || urlTab === "exam-console") return "seating";
  return "schedule"; // default, and "exam-date-sheet"
};

const AdminExams = () => {
  const [searchParams] = useSearchParams();
  const [topTab, setTopTab] = useState<ExamTopTab>(() => tabFromUrl(searchParams.get("tab")));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl md:text-2xl font-heading font-bold text-foreground">Exams</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Date sheets, roll numbers, and seating plans — everything exam-related in one place</p>
      </div>

      <div className="flex gap-1 bg-secondary/50 rounded-xl p-1 flex-wrap sm:flex-nowrap">
        <button onClick={() => setTopTab("schedule")}
          className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
            topTab === "schedule" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          }`}>
          <Calendar className="w-3.5 h-3.5" /> Date Sheet
        </button>
        <button onClick={() => setTopTab("rolls")}
          className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
            topTab === "rolls" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          }`}>
          <Hash className="w-3.5 h-3.5" /> Roll Numbers
        </button>
        <button onClick={() => setTopTab("seating")}
          className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
            topTab === "seating" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          }`}>
          <LayoutGrid className="w-3.5 h-3.5" /> Seating
        </button>
      </div>

      {topTab === "schedule" && <AdminExamSchedule />}
      {topTab === "rolls" && <AdminExamRollNumbers />}
      {topTab === "seating" && <AdminExamSeating />}
    </div>
  );
};

export default AdminExams;
