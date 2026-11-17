import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, IdCard, Smartphone, Loader2, Download, CheckCircle2, Info, AlertTriangle,
  X, ArrowRight, Briefcase, Building2, Hash, MapPin, CalendarCheck, Clock,
  CalendarDays, GraduationCap, FileText, Share2, ChevronDown,
} from "lucide-react";
import toast from "react-hot-toast";
import PageLayout from "@/components/layout/PageLayout";
import { downloadDutyOrderPDF } from "@/lib/dutyOrderPDF";
import { letterFacts } from "@/lib/letterModel";
import { shareDuty } from "@/lib/dutyShareImage";
import {
  useDrawSources, useDrawLookup, formatPkMobile,
  type DrawDetails, type DrawResult,
} from "@/hooks/useDrawLookup";

type By = "cnic" | "mobile";

/** Live-format while typing: CNIC 12345-1234567-1 · mobile 0300 1234567 */
const formatCnic = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 13);
  return [d.slice(0, 5), d.slice(5, 12), d.slice(12)].filter(Boolean).join("-");
};
const formatMobile = (v: string) => {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("92") && d.length > 10) d = "0" + d.slice(2);
  d = d.slice(0, 11);
  return d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
};

const ROWS: { key: keyof DrawDetails; label: string }[] = [
  { key: "designation", label: "Designation" },
  { key: "institute", label: "Institute" },
  { key: "centerNo", label: "Center No" },
  { key: "mobile", label: "Mobile No" },
];

/** Small badge icon for each duty-detail cell (purely decorative). */
const FIELD_ICON: Record<string, typeof IdCard> = {
  Designation: Briefcase,
  Institute: Building2,
  "Center No": Hash,
  "Mobile No": Smartphone,
  "Center Name": MapPin,
  "Report Date": CalendarCheck,
  "Report Time": Clock,
  "Draw Held On": CalendarDays,
  "Exam Starts": GraduationCap,
  "Ref No": FileText,
  Dated: CalendarCheck,
  CNIC: IdCard,
};

const slimBtn =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-4 text-[12px] font-semibold tracking-wide transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";

/** Sliding-pill segmented control (shared by duty-type tabs and CNIC/Mobile toggle) */
function Segmented<T extends string>({
  id, value, onChange, options, label,
}: {
  id: string; value: T; onChange: (v: T) => void; label: string;
  options: { value: T; label: string; icon?: typeof IdCard }[];
}) {
  return (
    <div role="tablist" aria-label={label} className="relative grid rounded-full border border-border/80 bg-secondary/60 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`relative z-10 flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[12.5px] font-semibold transition-colors ${active ? "text-[hsl(158_45%_14%)]" : "text-muted-foreground hover:text-foreground"}`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 -z-10 rounded-full border border-gold/50 bg-gradient-to-b from-white to-[hsl(45_80%_95%)] shadow-[0_4px_10px_-6px_hsl(38_70%_40%/.5)] dark:from-card dark:to-gold/10"
              />
            )}
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const Duties = () => {
  const { data: sources } = useDrawSources();
  const [sourceId, setSourceId] = useState("theory");
  const [by, setBy] = useState<By>("cnic");
  const [value, setValue] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const lookup = useDrawLookup();

  const source = useMemo(() => sources.find((s) => s.id === sourceId) ?? sources[0], [sources, sourceId]);
  const digits = value.replace(/\D/g, "");
  const ready = by === "cnic" ? digits.length === 13 : digits.length >= 10;
  const result: DrawResult | undefined = lookup.data;
  // everything shown is exactly what BISE returned: search result fields + the letter's own sentences
  const tableRows = useMemo(() => {
    if (!result?.selected) return [] as [string, string][];
    const rows: [string, string | undefined][] = ROWS.map(({ key, label }) => {
      const raw = result.details?.[key];
      return [label, key === "mobile" ? formatPkMobile(raw) : raw];
    });
    if (result.letterDoc?.length) {
      const f = letterFacts(result.letterDoc);
      rows.push(["Center Name", f.centerName], ["Report Date", f.reportDate], ["Report Time", f.reportTime],
        ["Draw Held On", f.drawDate], ["Exam Starts", f.commencing],
        ["Ref No", f.ref], ["Dated", f.dated], ["CNIC", f.cnic]);
    }
    return rows.filter(([, v]) => !!v) as [string, string][];
  }, [result]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || lookup.isPending) return;
    lookup.mutate({ source: sourceId, by, value });
  };
  const switchBy = (b: By) => { setBy(b); setValue(""); lookup.reset(); };
  const switchSource = (id: string) => { setSourceId(id); lookup.reset(); };

  const downloadOrder = async () => {
    if (!result?.details || pdfBusy) return;
    setPdfBusy(true);
    try {
      await downloadDutyOrderPDF({ letter: result.letterDoc, details: result.details, session: source.session, dutyLabel: source.label });
    } catch {
      toast.error("Could not create the PDF. Please try again.");
    } finally { setPdfBusy(false); }
  };

  const shareOrder = async () => {
    if (!result?.details || shareBusy) return;
    setShareBusy(true);
    try {
      const f = result.letterDoc?.length ? letterFacts(result.letterDoc) : undefined;
      const r = await shareDuty({ details: result.details, session: source.session, dutyLabel: source.label, facts: f });
      if (r === "downloaded") toast.success("Image saved — attach it in WhatsApp");
    } catch {
      toast.error("Could not create the share image. Please try again.");
    } finally { setShareBusy(false); }
  };

  return (
    <PageLayout>
      {/* ── Premium light hero ─────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-gold/25 bg-[radial-gradient(60%_80%_at_100%_0%,hsl(42_90%_72%/.35),transparent_65%),radial-gradient(60%_80%_at_0%_100%,hsl(150_40%_80%/.5),transparent_65%),linear-gradient(170deg,#FFFEFA,#F6F4E6_60%,#EAF2E3)] px-4 py-9 text-center dark:bg-[linear-gradient(170deg,hsl(150_10%_11%),hsl(150_12%_8%))] sm:py-12">
        <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full border border-gold/30 shadow-[0_0_0_26px_hsl(40_75%_55%/.05),0_0_0_27px_hsl(40_75%_50%/.16)]" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-20 h-60 w-60 rounded-full border border-primary/20 shadow-[0_0_0_24px_hsl(150_40%_45%/.05),0_0_0_25px_hsl(150_40%_40%/.14)]" />
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative mx-auto max-w-xl">
          <h1 className="font-luxe text-[2.5rem] font-bold leading-[1.05] tracking-tight text-[hsl(158_40%_12%)] dark:text-white sm:text-5xl">
            Exam <span className="bg-gradient-to-br from-[hsl(36_88%_36%)] via-[hsl(42_92%_50%)] to-[hsl(34_85%_38%)] bg-clip-text text-transparent">Duties</span>
          </h1>
          <div className="my-3 flex items-center justify-center gap-2" aria-hidden="true">
            <span className="h-px w-12 bg-gradient-to-r from-transparent to-gold" />
            <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
            <span className="h-px w-12 bg-gradient-to-l from-transparent to-gold" />
          </div>
          <p className="mx-auto max-w-sm font-luxe text-[1.05rem] font-medium italic leading-snug text-[hsl(158_14%_28%)] dark:text-white/75 sm:text-lg">
            Check your supervisory draw result, live from the Board
          </p>
        </motion.div>
      </section>

      <section className="px-4 pb-16 pt-8 sm:pt-10">
        <div className="mx-auto w-full min-w-0 max-w-xl">
          {/* ── Lookup card ─────────────────────────────────────────── */}
          <div className="rounded-[28px] border border-border bg-card p-5 shadow-[0_24px_60px_-34px_hsl(var(--primary)/.45)] sm:p-7">
            <Segmented
              id="source" label="Duty type" value={sourceId} onChange={switchSource}
              options={sources.map((s) => ({ value: s.id, label: s.label }))}
            />

            <div className="my-6 text-center">
              <h2 className="break-words font-luxe text-[1.9rem] font-bold leading-tight text-foreground sm:text-4xl">{source.session}</h2>
              <div className="mx-auto my-2.5 flex items-center justify-center gap-2" aria-hidden="true">
                <span className="h-px w-9 bg-gradient-to-r from-transparent to-gold" />
                <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
                <span className="h-px w-9 bg-gradient-to-l from-transparent to-gold" />
              </div>
            </div>

            <form onSubmit={submit} noValidate>
              <label htmlFor="draw-value" className="mb-1.5 block text-center text-[10.5px] font-bold uppercase tracking-[0.2em] text-primary">
                {by === "cnic" ? "CNIC Number" : "Mobile Number"}
              </label>
              <div className="group relative">
                <span className="pointer-events-none absolute left-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-primary">
                  {by === "cnic" ? <IdCard className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                </span>
                <input
                  id="draw-value"
                  inputMode="numeric"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(by === "cnic" ? formatCnic(e.target.value) : formatMobile(e.target.value))}
                  placeholder={by === "cnic" ? "17301-1234567-1" : "0301 2345678"}
                  className="h-11 w-full rounded-full border border-border bg-background px-12 text-center font-body text-[1rem] font-semibold tracking-[0.1em] text-foreground shadow-[inset_0_1px_3px_hsl(var(--primary)/.08)] outline-none transition-all placeholder:text-[0.95rem] placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/50 focus:border-gold focus:shadow-[0_0_0_4px_hsl(var(--gold)/.18)]"
                />
                {value && (
                  <button type="button" aria-label="Clear" onClick={() => setValue("")} className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="relative h-10 min-w-0 flex-1 sm:max-w-[190px]">
                  <span className="pointer-events-none absolute inset-0 flex items-center gap-2 rounded-full border border-gold/55 bg-gradient-to-b from-white to-[hsl(45_80%_95%)] pl-3.5 pr-9 text-[13px] font-bold text-[hsl(158_45%_14%)] shadow-[0_8px_18px_-12px_hsl(38_70%_40%/.6),inset_0_1px_0_hsl(0_0%_100%/.8)] dark:from-card dark:to-gold/10 dark:text-foreground">
                    {by === "cnic" ? <IdCard className="h-4 w-4 shrink-0 text-[hsl(36_75%_36%)]" /> : <Smartphone className="h-4 w-4 shrink-0 text-[hsl(36_75%_36%)]" />}
                    <span className="truncate">{by === "cnic" ? "CNIC" : "Mobile No"}</span>
                  </span>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(36_75%_36%)]" />
                  <select
                    aria-label="Search by"
                    value={by}
                    onChange={(e) => switchBy(e.target.value as By)}
                    className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
                  >
                    <option value="cnic">CNIC</option>
                    <option value="mobile">Mobile No</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={!ready || lookup.isPending}
                  className="group relative flex h-10 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full bg-gradient-to-b from-[hsl(46_96%_72%)] to-[hsl(38_88%_50%)] px-5 text-[12.5px] font-bold tracking-wide text-[hsl(158_45%_10%)] shadow-[0_12px_22px_-14px_hsl(38_85%_42%/.8),inset_0_1px_0_hsl(0_0%_100%/.55)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {lookup.isPending ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>) : (<><Search className="h-3.5 w-3.5" /> Check My Duty <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></>)}
                </button>
              </div>
            </form>
          </div>

          {/* ── Result ──────────────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {result && !lookup.isPending && (
              <motion.div
                key={`${result.ok}-${result.selected}-${result.fetched_at}`}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }}
                className="mt-7" aria-live="polite"
              >
                {!result.ok ? (
                  <Notice tone="warn" icon={AlertTriangle} title="Couldn't reach the Board">{result.error || "Something went wrong. Please try again."}</Notice>
                ) : result.selected ? (
                  <div className="overflow-hidden rounded-[28px] border border-gold/40 bg-card shadow-[0_24px_60px_-34px_hsl(var(--gold)/.7)]">
                    {/* Header */}
                    <div className="relative bg-gradient-to-b from-[hsl(45_90%_94%)] to-card px-5 pb-5 pt-6 text-center dark:from-gold/10">
                      <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><CheckCircle2 className="h-6 w-6" /></span>
                      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">You are selected for duty</p>
                      <h3 className="mt-2 break-words font-luxe text-[1.9rem] font-bold leading-tight text-foreground">{result.details?.name}</h3>
                      {result.details?.appointedAs && (
                        <span className="mt-3 inline-flex max-w-full items-center rounded-full border border-gold/50 bg-white px-4 py-1.5 text-[13px] font-bold uppercase tracking-[0.14em] text-[hsl(38_85%_30%)] shadow-sm dark:bg-gold/15 dark:text-gold">
                          <span className="truncate">{result.details.appointedAs}</span>
                        </span>
                      )}
                      <p className="mt-3 text-[12px] font-medium text-muted-foreground">{source.session} · {source.label}</p>
                    </div>

                    {/* Duty details — two-column premium grid, centered in each cell */}
                    <div className="px-4 pb-2 pt-5 sm:px-6">
                      <div className="mb-3.5 flex items-center justify-center gap-2.5" aria-hidden="true">
                        <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold/70" />
                        <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
                        <span className="text-[9.5px] font-bold uppercase tracking-[0.26em] text-primary/70">Duty Details</span>
                        <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
                        <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold/70" />
                      </div>
                      <div className="overflow-hidden rounded-2xl border border-gold/40 bg-card shadow-[0_14px_30px_-22px_hsl(var(--gold)/.8)]">
                        <table className="w-full table-fixed border-collapse text-center">
                          <tbody>
                            {Array.from({ length: Math.ceil(tableRows.length / 2) }, (_, r) => tableRows.slice(r * 2, r * 2 + 2)).map((pair, r) => (
                              <tr key={r} className={r > 0 ? "border-t border-gold/25" : ""}>
                                {pair.map(([label, v], c) => {
                                  const Icon = FIELD_ICON[label] ?? FileText;
                                  return (
                                    <td
                                      key={label}
                                      colSpan={pair.length === 1 ? 2 : 1}
                                      className={`w-1/2 px-2 py-3 align-middle ${c === 0 && pair.length > 1 ? "border-r border-gold/25" : ""} ${r % 2 === 0 ? "bg-secondary/40 dark:bg-secondary/20" : "bg-card"}`}
                                    >
                                      <span className="flex flex-col items-center justify-center">
                                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/35 bg-gradient-to-b from-[hsl(46_96%_91%)] to-[hsl(42_85%_82%)] text-[hsl(36_75%_32%)] shadow-[inset_0_1px_0_hsl(0_0%_100%/.65)] dark:border-gold/25 dark:from-gold/20 dark:to-gold/5 dark:text-gold"><Icon className="h-3.5 w-3.5" /></span>
                                        <span className="mt-1.5 text-[9px] font-bold uppercase leading-tight tracking-[0.15em] text-primary/90">{label}</span>
                                        <span className="mt-0.5 w-full break-words text-[13px] font-bold leading-snug text-foreground [overflow-wrap:anywhere]">{v}</span>
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="mx-auto grid w-full max-w-[300px] grid-cols-2 gap-3 px-4 pb-6 pt-4">
                      <button type="button" onClick={downloadOrder} disabled={pdfBusy} className={`${slimBtn} w-full border border-primary/20 bg-primary text-primary-foreground shadow-[0_10px_20px_-14px_hsl(var(--primary)/.8)]`}>
                        {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        {pdfBusy ? "Preparing…" : "Download"}
                      </button>
                      <button type="button" onClick={shareOrder} disabled={shareBusy} className={`${slimBtn} w-full border border-gold/60 bg-gradient-to-b from-[hsl(46_96%_72%)] to-[hsl(38_88%_52%)] text-[hsl(158_45%_10%)] shadow-[0_10px_20px_-14px_hsl(38_85%_42%/.8)]`}>
                        {shareBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                        {shareBusy ? "Preparing…" : "Share"}
                      </button>
                    </div>

                  </div>
                ) : (
                  <Notice tone="info" icon={Info} title="Not selected in this draw">
                    The Computerized Draw did not select this {by === "cnic" ? "CNIC" : "number"} for {source.label.toLowerCase()}. Try the other duty type, or the other detail.
                  </Notice>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </PageLayout>
  );
};

const Notice = ({ tone, icon: Icon, title, children }: { tone: "info" | "warn"; icon: typeof Info; title: string; children: React.ReactNode }) => (
  <div className={`rounded-[28px] border p-6 text-center ${tone === "warn" ? "border-amber-400/50 bg-amber-50 dark:bg-amber-500/10" : "border-border bg-card"}`}>
    <Icon className={`mx-auto mb-2 h-7 w-7 ${tone === "warn" ? "text-amber-600" : "text-primary"}`} />
    <p className="mb-1 break-words font-luxe text-2xl font-bold text-foreground">{title}</p>
    <div className="break-words text-[14px] leading-relaxed text-muted-foreground">{children}</div>
  </div>
);

export default Duties;
