// src/pages/dashboard/tabs/ExamScheduleTab.tsx
// Feature 6 – Exam Date Sheet (student view + printable)

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { examTypeLabel } from "@/utils/examTypeLabel";
import { useExamSchedule } from "@/hooks/useNewFeatures";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Printer, ChevronRight, CalendarPlus } from "lucide-react";
import { format, isPast, isToday, differenceInDays } from "date-fns";
import { generateExamICS } from "@/utils/generateExamICS";

const classes = ["6", "7", "8", "9", "10"];
const getExamTypes = (cls: string) => ["9", "10"].includes(cls) ? ["Annual-I", "Annual-II"] : ["1st Semester", "2nd Semester"];
const currentYear = new Date().getFullYear();

function SubjectBadge({ subject }: { subject: string }) {
  const colors: Record<string, string> = {
    English: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    Urdu: "bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400",
    Maths: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    Mathematics: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    Physics: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
    Chemistry: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    Biology: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${colors[subject] || "bg-secondary text-secondary-foreground"}`}>{subject}</span>;
}

const ExamScheduleTab = () => {
  const { profile } = useAuth();
  const [cls, setCls] = useState(profile?.class || "6");
  const [examType, setExamType] = useState(getExamTypes(profile?.class || "6")[0]);
  const [year] = useState(currentYear);

  const { data: schedule = [], isLoading } = useExamSchedule(cls, examType, year);

  const handlePrint = () => window.print();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" /> Exam Date Sheet
          </h2>
          <p className="text-xs text-muted-foreground">{year} examination schedule</p>
        </div>
        {schedule.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => generateExamICS(schedule, cls, examType, year)}
              className="flex items-center gap-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-lg transition-colors"
              title="Download .ics — import into Google Calendar, iPhone Calendar, Outlook"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              Add to Calendar
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-secondary px-3 py-1.5 rounded-lg transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {classes.map((c) => (
          <button key={c} onClick={() => { setCls(c); setExamType(getExamTypes(c)[0]); }}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${cls === c ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
            Class {c}
          </button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {getExamTypes(cls).map((e) => (
          <button key={e} onClick={() => setExamType(e)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${examType === e ? "bg-primary/20 text-primary border border-primary/30" : "bg-secondary text-muted-foreground"}`}>
            {examTypeLabel(e)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : schedule.length === 0 ? (
        <div className="bg-card rounded-2xl p-10 text-center shadow-card">
          <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No exam schedule published yet for this class.</p>
        </div>
      ) : (
        <div className="space-y-2 print:space-y-1">
          {schedule.map((entry, i) => {
            const date = new Date(entry.exam_date);
            const past = isPast(date) && !isToday(date);
            const today = isToday(date);
            const diff = differenceInDays(date, new Date());
            return (
              <div key={entry.id} className={`bg-card rounded-xl border p-4 flex items-center gap-4 shadow-sm transition-all ${
                today ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/10" :
                past ? "opacity-60 border-border" : "border-border hover:border-primary/30"
              }`}>
                <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0 ${
                  today ? "bg-blue-500 text-white" :
                  past ? "bg-secondary text-muted-foreground" :
                  "bg-primary text-primary-foreground"
                }`}>
                  <span className="text-lg font-black leading-none">{format(date, "dd")}</span>
                  <span className="text-[10px] font-semibold uppercase">{format(date, "MMM")}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SubjectBadge subject={entry.subject} />
                    {today && <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">TODAY</span>}
                    {!past && !today && diff <= 3 && <span className="text-[10px] font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">{diff}d left</span>}
                  </div>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{entry.subject}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span>{format(date, "EEEE, dd MMMM yyyy")}</span>
                    {entry.start_time && <span className="flex items-center gap-0.5"><ChevronRight className="w-3 h-3" />{entry.start_time}{entry.end_time ? ` – ${entry.end_time}` : ""}</span>}
                    {entry.hall && <span>Hall: {entry.hall}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ExamScheduleTab;
