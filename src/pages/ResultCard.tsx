import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, FileText, Trophy, Loader2, Printer } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import { supabase } from "@/lib/supabase";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import toast from "react-hot-toast";
import { examTypeLabel } from "@/utils/examTypeLabel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubjectMark { obtained: number; total: number; }

interface ResultRecord {
  id: string;
  student_id: string;
  class: string;
  exam_type: string;
  year: number;
  total_marks: number;
  obtained_marks: number;
  percentage: number;
  grade: string | null;
  is_pass: boolean;
  remarks: string | null;
  exam_roll_no: string | null;
  position: number | null;
  subject_marks: Record<string, SubjectMark> | null;
  students: {
    full_name: string;
    roll_number: string;
    father_name: string | null;
    photo_url: string | null;
    class: string;
  } | null;
}

interface SchoolInfo {
  school_name: string;
  address: string;
  emis_code: string;
  logo_url: string | null;
  phone: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const gradeFromPct = (pct: number) => {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 60) return "B";
  if (pct >= 45) return "C";
  if (pct >= 33) return "D";
  return "Fail";
};

const gradeHex = (g: string | null) => {
  switch (g) {
    case "A+": return "#0369A1";
    case "A":  return "#0EA5E9";
    case "B":  return "#0D9488";
    case "C":  return "#1e3a8a";
    case "D":  return "#EA580C";
    default:   return "#DC2626";
  }
};

// ─── Build DMC HTML ───────────────────────────────────────────────────────────

const buildDMC = (r: ResultRecord, school: SchoolInfo): string => {
  const studentName  = r.students?.full_name   || "—";
  const fatherName   = r.students?.father_name  || "—";
  const classRollNo  = r.students?.roll_number  || "—";
  const examRollNo   = r.exam_roll_no            || "—";
  const photoUrl     = r.students?.photo_url    || null;
  const logoUrl      = school.logo_url           || null;

  // Filter out subjects where both obtained AND total are 0 — these were not included in this result
  const subjects = r.subject_marks
    ? Object.entries(r.subject_marks).filter(([, m]) => !(m.obtained === 0 && m.total === 0))
    : [];

  const subjectRows = subjects.map(([name, m], idx) => {
    const pct   = m.total > 0 ? Math.round((m.obtained / m.total) * 100) : 0;
    const grade = gradeFromPct(pct);
    const pass  = pct >= 33;
    return `
      <tr style="background:${idx % 2 === 0 ? "#F8FAFF" : "#fff"}">
        <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;font-weight:500">${name}</td>
        <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:center">${m.total}</td>
        <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:center;font-weight:700;color:#0369A1">${m.obtained}</td>
        <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:center">${pct}%</td>
        <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:center;font-weight:700;color:${gradeHex(grade)}">${grade}</td>
        <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:center;font-weight:600;color:${pass ? "#16A34A" : "#DC2626"}">${pass ? "Pass" : "Fail"}</td>
      </tr>`;
  }).join("");

  const posBadge = r.position && r.position <= 3
    ? (r.position === 1 ? "🥇 1st Position" : r.position === 2 ? "🥈 2nd Position" : "🥉 3rd Position")
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DMC — ${studentName} — ${examTypeLabel(r.exam_type)} ${r.year}</title>
<style>
  @page { size:A4 portrait; margin:10mm; }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Calibri,Arial,sans-serif;background:#fff;color:#1E293B;font-size:13px}
  .dmc{max-width:760px;margin:0 auto;border:2.5px solid #0EA5E9;border-radius:8px;overflow:hidden}

  .header{background:linear-gradient(135deg,#0C4A6E,#0369A1 45%,#0EA5E9);padding:16px 20px 14px;display:flex;align-items:center;gap:14px}
  .logo-wrap{width:68px;height:68px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden}
  .logo-wrap img{width:100%;height:100%;object-fit:contain;padding:4px}
  .logo-txt{font-size:20px;font-weight:900;color:#0369A1}
  .school-center{flex:1;text-align:center;color:#fff}
  .school-name{font-size:19px;font-weight:800;letter-spacing:0.4px}
  .school-addr{font-size:10.5px;opacity:.85;margin-top:2px}
  .dmc-badge{display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);border-radius:20px;padding:3px 14px;font-size:12px;font-weight:700;letter-spacing:1.5px;margin-top:6px}
  .emis-line{font-size:9.5px;opacity:.7;margin-top:3px}
  .photo-wrap{width:70px;height:88px;border-radius:4px;border:2.5px solid rgba(255,255,255,0.5);overflow:hidden;background:rgba(255,255,255,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center}
  .photo-wrap img{width:100%;height:100%;object-fit:cover}
  .photo-init{font-size:28px;font-weight:900;color:#fff}
  .photo-spacer{width:70px;flex-shrink:0}

  .exam-bar{background:#0EA5E9;color:#fff;display:flex;justify-content:space-around;padding:7px 16px}
  .ei{text-align:center}
  .ei-label{font-size:9px;opacity:.8;text-transform:uppercase;letter-spacing:.7px}
  .ei-val{font-size:13px;font-weight:800;margin-top:1px}

  .stu-grid{padding:12px 18px;display:grid;grid-template-columns:1fr 1fr;gap:7px;background:#F8FAFF;border-bottom:2px solid #E0F2FE}
  .ir{display:flex;gap:8px;align-items:baseline}
  .il{font-size:9.5px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;min-width:80px}
  .iv{font-size:13px;font-weight:600;color:#0F172A}

  .tbl-wrap{padding:12px 18px}
  .sec-title{font-size:10px;font-weight:700;color:#0369A1;text-transform:uppercase;letter-spacing:1px;margin-bottom:7px}
  table{width:100%;border-collapse:collapse}
  thead tr{background:linear-gradient(90deg,#0369A1,#0EA5E9)}
  thead th{padding:7px 10px;font-size:10.5px;font-weight:700;color:#fff;text-align:center;border:1px solid #0369A1;text-transform:uppercase;letter-spacing:.4px}
  thead th:first-child{text-align:left}
  .tfoot-row td{background:#EFF6FF;font-weight:800;font-size:13px;color:#0369A1;border:1px solid #93C5FD;padding:7px 10px;text-align:center}
  .tfoot-row td:first-child{text-align:left}

  .summary{margin:12px 18px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .sbox{border:1px solid #E0F2FE;border-radius:7px;padding:9px;text-align:center;background:#F8FAFF}
  .sl{font-size:9px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;font-weight:700}
  .sv{font-size:20px;font-weight:900;margin-top:2px}

  .status-bar{margin:0 18px 10px;text-align:center;padding:9px;border-radius:7px}

  .pos-badge{text-align:center;padding:6px;margin:0 18px 9px;background:#EFF6FF;border:1px solid #bfdbfe;border-radius:7px;font-size:12.5px;font-weight:700;color:#1e3a8a}
  .remarks-box{margin:0 18px 12px;background:#EFF6FF;border:1px solid #bfdbfe;border-radius:5px;padding:7px 11px;font-size:11.5px;color:#172554}

  .sig-section{margin:8px 18px 0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;padding-top:8px;border-top:1px solid #E2E8F0}
  .sig-box{text-align:center}
  .sig-line{height:1px;background:#475569;margin:30px 6px 4px}
  .sig-lbl{font-size:9.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.4px}

  .footer{background:#F1F5F9;padding:7px 18px;display:flex;justify-content:space-between;align-items:center;margin-top:12px;border-top:1px solid #CBD5E1}
  .fl{font-size:9.5px;color:#64748B}
  .fr{font-size:9.5px;color:#0369A1;font-weight:600}

  @media print{body{background:#fff}.dmc{border:2.5px solid #0EA5E9;box-shadow:none}@page{margin:8mm}}
</style>
</head>
<body>
<div class="dmc">

  <div class="header">
    <div class="logo-wrap">
      ${logoUrl ? `<img src="${logoUrl}" alt="Logo"/>` : `<span class="logo-txt">GHS</span>`}
    </div>
    <div class="school-center">
      <div class="school-name">${school.school_name}</div>
      <div class="school-addr">${school.address}</div>
      <div class="dmc-badge">DETAIL MARKS CERTIFICATE</div>
      <div class="emis-line">EMIS: ${school.emis_code}${school.phone ? ` &nbsp;|&nbsp; Ph: ${school.phone}` : ""}</div>
    </div>
    ${photoUrl ? `<div class="photo-wrap"><img src="${photoUrl}" alt=""/></div>` : `<div class="photo-spacer"></div>`}
  </div>

  <div class="exam-bar">
    <div class="ei"><div class="ei-label">Examination</div><div class="ei-val">${examTypeLabel(r.exam_type)}</div></div>
    <div class="ei"><div class="ei-label">Year</div><div class="ei-val">${r.year}</div></div>
    <div class="ei"><div class="ei-label">Class</div><div class="ei-val">${r.class}</div></div>
    <div class="ei"><div class="ei-label">Exam Roll No</div><div class="ei-val">${examRollNo}</div></div>
    <div class="ei"><div class="ei-label">Class Roll No</div><div class="ei-val">${classRollNo}</div></div>
  </div>

  <div class="stu-grid">
    <div class="ir"><span class="il">Student Name</span><span class="iv">${studentName}</span></div>
    <div class="ir"><span class="il">Father Name</span><span class="iv">${fatherName}</span></div>
    <div class="ir"><span class="il">Class</span><span class="iv">${r.class}</span></div>
    <div class="ir"><span class="il">Session</span><span class="iv">${examTypeLabel(r.exam_type)} ${r.year}</span></div>
  </div>

  <div class="tbl-wrap">
    <div class="sec-title">Subject-wise Marks</div>
    ${subjects.length === 0 ? `
      <div style="text-align:center;padding:16px;color:#64748B;font-size:12px;border:1px solid #E0F2FE;border-radius:6px;background:#F8FAFF">
        Subject-wise marks not entered. See summary below.
      </div>
    ` : `
    <table>
      <thead><tr>
        <th style="text-align:left;width:34%">Subject</th>
        <th>Total Marks</th><th>Obtained</th><th>Percentage</th><th>Grade</th><th>Result</th>
      </tr></thead>
      <tbody>${subjectRows}</tbody>
      <tfoot><tr class="tfoot-row">
        <td><strong>GRAND TOTAL</strong></td>
        <td>${r.total_marks}</td>
        <td><strong>${r.obtained_marks}</strong></td>
        <td><strong>${r.percentage}%</strong></td>
        <td colspan="2"></td>
      </tr></tfoot>
    </table>`}
  </div>

  <div class="summary">
    <div class="sbox"><div class="sl">Total Marks</div><div class="sv" style="color:#0369A1">${r.total_marks}</div></div>
    <div class="sbox"><div class="sl">Obtained</div><div class="sv" style="color:#0EA5E9">${r.obtained_marks}</div></div>
    <div class="sbox"><div class="sl">Percentage</div><div class="sv" style="color:#0369A1">${r.percentage}%</div></div>
    <div class="sbox" style="border-color:${r.is_pass?"#BBF7D0":"#FECACA"};background:${r.is_pass?"#F0FDF4":"#FEF2F2"}">
      <div class="sl">Grade</div>
      <div class="sv" style="color:${r.is_pass?"#16A34A":"#DC2626"}">${r.grade || "—"}</div>
    </div>
  </div>

  <div class="status-bar" style="border:2px solid ${r.is_pass?"#BBF7D0":"#FECACA"};background:${r.is_pass?"#F0FDF4":"#FEF2F2"}">
    <span style="font-size:18px;font-weight:900;color:${r.is_pass?"#16A34A":"#DC2626"};letter-spacing:2px">
      ${r.is_pass ? "✓  PASS" : "✗  FAIL"}
    </span>
    ${r.position ? `<span style="font-size:12px;color:#64748B;margin-left:18px">Position: <strong style="color:#0369A1">#${r.position}</strong> in Class</span>` : ""}
  </div>

  ${posBadge ? `<div class="pos-badge">${posBadge}</div>` : ""}
  ${r.remarks ? `<div class="remarks-box">📝 <strong>Remarks:</strong> ${r.remarks}</div>` : ""}

  <div class="sig-section">
    <div class="sig-box"><div class="sig-line"></div><div class="sig-lbl">Class Teacher</div></div>
    <div class="sig-box"><div class="sig-line"></div><div class="sig-lbl">Exam In-Charge</div></div>
    <div class="sig-box"><div class="sig-line"></div><div class="sig-lbl">Headmaster / Principal</div></div>
  </div>

  <div class="footer">
    <div class="fl">${school.school_name} &nbsp;|&nbsp; ${school.address}</div>
    <div class="fr">✓ Official DMC &nbsp;|&nbsp; ${examTypeLabel(r.exam_type)} ${r.year}</div>
  </div>

</div>
</body>
</html>`;
};

// ─── Print DMC ────────────────────────────────────────────────────────────────

const printDMC = (r: ResultRecord, school: SchoolInfo) => {
  const html = buildDMC(r, school);
  const win = window.open("", "_blank", "width=900,height=720");
  if (!win) {
    toast.error("Popup blocked. Please allow popups and try again.");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.onload = () => {
    setTimeout(() => { win.focus(); win.print(); }, 600);
  };
  toast.success("DMC opened. In print dialog choose 'Save as PDF'.");
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const ResultCard = () => {
  const { data: settings } = useSchoolSettings();

  const school: SchoolInfo = {
    school_name: settings?.school_name || "GHS Babi Khel",
    address:     settings?.address     || "Babi Khel, District Mohmand, KPK",
    emis_code:   settings?.emis_code   || "60673",
    logo_url:    settings?.logo_url    || null,
    phone:       settings?.phone       || null,
  };

  const [searchName, setSearchName] = useState("");
  const [searchRoll, setSearchRoll] = useState("");
  const [searched,   setSearched]   = useState(false);
  const [searching,  setSearching]  = useState(false);
  const [results,    setResults]    = useState<ResultRecord[]>([]);

  const handleSearch = async () => {
    if (!searchName.trim() && !searchRoll.trim()) {
      toast.error("Enter your name or exam roll number");
      return;
    }
    setSearching(true);
    setSearched(false);

    try {
      let query = supabase
        .from("results")
        .select("id,student_id,class,exam_type,year,total_marks,obtained_marks,percentage,grade,is_pass,remarks,exam_roll_no,position,subject_marks,students(full_name,roll_number,father_name,photo_url,class)")
        .eq("is_published", true)
        .order("year", { ascending: false });

      if (searchRoll.trim()) {
        query = query.eq("exam_roll_no", searchRoll.trim());
      } else {
        const { data: stds } = await supabase
          .from("students").select("id")
          .ilike("full_name", `%${searchName.trim()}%`);
        if (!stds?.length) {
          setResults([]); setSearched(true); setSearching(false); return;
        }
        query = query.in("student_id", stds.map(s => s.id));
      }

      const { data, error } = await query.limit(10);
      if (error) throw error;
      let rows = (data ?? []) as unknown as ResultRecord[];

      // ── Fallback: fill in exam_roll_no from exam_roll_numbers table ──────
      // A result row can have a blank exam_roll_no if the admin generated the
      // roll number in "Exam Roll Numbers" but never attached it to this
      // particular result (e.g. added via CSV import). exam_roll_numbers is
      // scoped by session_id, and each session has its own exam_year +
      // exam_term (e.g. "1st Semester" 2026) — the same naming as
      // results.exam_type/year — so we match through exam_roll_sessions on
      // year + term + class + student, instead of just student_id + class
      // (which could grab the wrong session if a student has roll numbers
      // from more than one exam).
      const missing = rows.filter(r => !r.exam_roll_no && r.student_id && r.class);
      if (missing.length > 0) {
        const years = Array.from(new Set(missing.map(r => r.year)));
        const terms = Array.from(new Set(missing.map(r => r.exam_type)));
        const { data: sessions } = await supabase
          .from("exam_roll_sessions")
          .select("id, exam_year, exam_term")
          .in("exam_year", years)
          .in("exam_term", terms);

        if (sessions?.length) {
          const { data: rolls } = await supabase
            .from("exam_roll_numbers")
            .select("student_id, class, exam_roll_no, session_id")
            .in("session_id", sessions.map(s => s.id))
            .in("student_id", missing.map(r => r.student_id));

          if (rolls?.length) {
            const sessionKey = (id: string) => {
              const s = sessions.find(s => s.id === id);
              return s ? `${s.exam_year}|${s.exam_term}` : "";
            };
            rows = rows.map(r => {
              if (r.exam_roll_no) return r;
              const match = rolls.find(rl =>
                rl.student_id === r.student_id &&
                rl.class === r.class &&
                sessionKey(rl.session_id) === `${r.year}|${r.exam_type}`
              );
              return match ? { ...r, exam_roll_no: match.exam_roll_no } : r;
            });
          }
        }
      }

      setResults(rows);
    } catch (e) {
      toast.error("Search failed. Try again.");
    }

    setSearched(true);
    setSearching(false);
  };

  return (
    <PageLayout>
      <PageBanner title="Result Card / DMC" subtitle="Search by name or exam roll number and download your official DMC" />

      <section className="py-12">
        <div className="container mx-auto px-4 max-w-2xl">

          {/* Search */}
          <div className="bg-card rounded-2xl shadow-elevated p-6 mb-8 border border-border">
            <h3 className="font-heading font-bold text-foreground text-lg mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-primary" /> Search Your Result
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Student Name</label>
                <input value={searchName} onChange={e => setSearchName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  placeholder="Enter your full name..."
                  className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:ring-2 focus:ring-ring outline-none" />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium">OR</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Exam Roll Number</label>
                <input value={searchRoll} onChange={e => setSearchRoll(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  placeholder="e.g. 100001"
                  className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-ring outline-none" />
              </div>
              <button onClick={handleSearch} disabled={searching}
                className="w-full gradient-accent text-primary-foreground font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 shadow-card hover:shadow-elevated transition-all">
                {searching ? <><Loader2 className="w-4 h-4 animate-spin"/>Searching...</> : <><Search className="w-4 h-4"/>Search Result</>}
              </button>
            </div>
          </div>

          {/* Results */}
          <AnimatePresence>
            {searched && (
              <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} className="space-y-5">
                {results.length === 0 ? (
                  <div className="bg-card rounded-2xl p-10 text-center shadow-card">
                    <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <h3 className="font-heading font-semibold text-foreground">No Result Found</h3>
                    <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
                      Check your name or exam roll number. Results must be added by admin first.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground font-medium">Found {results.length} result{results.length > 1 ? "s" : ""}</p>
                    {results.map(r => (
                      <motion.div key={r.id} initial={{ opacity:0, scale:0.98 }} animate={{ opacity:1, scale:1 }}
                        className="bg-card rounded-2xl shadow-elevated overflow-hidden border border-border">

                        {/* Header */}
                        <div className="gradient-hero px-6 py-5 text-on-hero">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                              {r.students?.photo_url
                                ? <img src={r.students.photo_url} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-white/40" />
                                : <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold border-2 border-white/30">{(r.students?.full_name||"S").charAt(0)}</div>
                              }
                              <div>
                                <p className="text-xs opacity-75">{examTypeLabel(r.exam_type)} {r.year} — Class {r.class}</p>
                                <h3 className="font-heading font-bold text-xl">{r.students?.full_name}</h3>
                                <p className="text-xs opacity-80 mt-0.5">Father: {r.students?.father_name||"—"} &nbsp;·&nbsp; Roll: {r.students?.roll_number}</p>
                              </div>
                            </div>
                            {r.exam_roll_no && (
                              <div className="text-right shrink-0">
                                <p className="text-xs opacity-70">Exam Roll No</p>
                                <p className="font-mono font-bold text-2xl tracking-wider">{r.exam_roll_no}</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Quick stats */}
                        <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
                          {[
                            { label:"Total",   value: r.total_marks },
                            { label:"Obtained",value: r.obtained_marks },
                            { label:"%",       value: `${r.percentage}%` },
                            { label:"Grade",   value: r.grade||"—" },
                          ].map(item => (
                            <div key={item.label} className="p-3 text-center">
                              <p className="text-xs text-muted-foreground">{item.label}</p>
                              <p className="text-lg font-bold text-foreground">{item.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Subject preview */}
                        {r.subject_marks && Object.entries(r.subject_marks).some(([, m]) => !(m.obtained === 0 && m.total === 0)) && (
                          <div className="px-5 py-4 border-b border-border">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Subject-wise Marks</p>
                            <div className="space-y-2">
                              {Object.entries(r.subject_marks).filter(([, m]) => !(m.obtained === 0 && m.total === 0)).map(([sub, m]) => {
                                const pct = m.total > 0 ? Math.round((m.obtained / m.total) * 100) : 0;
                                return (
                                  <div key={sub} className="flex items-center gap-3">
                                    <span className="text-sm text-foreground w-36 shrink-0">{sub}</span>
                                    <div className="flex-1 bg-secondary rounded-full h-2">
                                      <div className="h-2 rounded-full bg-primary" style={{ width:`${Math.min(pct,100)}%` }} />
                                    </div>
                                    <span className="text-sm font-semibold text-foreground w-16 text-right shrink-0">{m.obtained}/{m.total}</span>
                                    <span className="text-xs text-muted-foreground w-8 text-right shrink-0">{pct}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Status */}
                        <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-border">
                          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-bold"
                            style={{ background:r.is_pass?"#F0FDF4":"#FEF2F2", color:r.is_pass?"#16A34A":"#DC2626", border:`1px solid ${r.is_pass?"#BBF7D0":"#FECACA"}` }}>
                            {r.is_pass ? "✓ PASS" : "✗ FAIL"}
                          </span>
                          {r.position && r.position <= 10 && (
                            <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-900 px-3 py-1.5 rounded-xl text-sm font-semibold">
                              <Trophy className="w-4 h-4" />
                              {r.position === 1?"🥇 1st":r.position===2?"🥈 2nd":r.position===3?"🥉 3rd":`#${r.position}`} in Class
                            </span>
                          )}
                          {r.remarks && <span className="text-sm text-muted-foreground italic">📝 {r.remarks}</span>}
                        </div>

                        {/* Download DMC */}
                        <div className="p-5">
                          <button onClick={() => printDMC(r, school)}
                            className="w-full gradient-accent text-primary-foreground font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-card hover:shadow-elevated">
                            <Printer className="w-4 h-4" />
                            Download DMC as PDF
                          </button>
                          <p className="text-xs text-center text-muted-foreground mt-2">
                            A print window opens → choose "Save as PDF" to download
                          </p>
                        </div>

                      </motion.div>
                    ))}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </PageLayout>
  );
};

export default ResultCard;
