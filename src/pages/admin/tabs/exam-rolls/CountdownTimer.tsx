import { useState, useEffect, useRef } from "react";
import { Timer, CheckCircle2 } from "lucide-react";

// Countdown display component.
// Shows the remaining time while a countdown runs. Because sessions are
// now published the moment a countdown is SET (not when it ends), reaching
// zero simply means the slips are live — the card flips to a green
// "Live Now" state instead of the old stuck "Publishing now...".
// onExpire lets the parent refresh its badges/status the moment it fires.
export default function CountdownTimer({ targetDate, label, onExpire }: { targetDate: string; label: string; onExpire?: () => void }) {
  const [parts, setParts] = useState<{ d: number; h: number; m: number; s: number } | null>(null);
  const [expired, setExpired] = useState(false);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    expiredRef.current = false;
    setExpired(false);
    const calc = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        setParts(null);
        if (!expiredRef.current) {
          expiredRef.current = true;
          setExpired(true);
          onExpireRef.current?.();
        }
        return;
      }
      setParts({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [targetDate]);

  if (expired) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <CheckCircle2 className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">{label || "Roll numbers publish in"}</p>
          <p className="text-sm font-bold text-emerald-900 dark:text-emerald-300">Live now — slips are visible to students</p>
        </div>
      </div>
    );
  }

  const cells: [string, number | undefined][] = [
    ["Days", parts?.d], ["Hrs", parts?.h], ["Min", parts?.m], ["Sec", parts?.s],
  ];
  return (
    <div className="rounded-xl border border-slate-700/60 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 px-3 py-2.5 text-white">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
        </span>
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300">{label || "Roll numbers publish in"}</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {cells.map(([name, v]) => (
          <div key={name} className="rounded-lg bg-white/[0.08] py-1.5 text-center">
            <div className="font-mono text-lg font-bold leading-none tabular-nums sm:text-2xl">{String(v ?? 0).padStart(2, "0")}</div>
            <div className="mt-1 text-[9px] font-medium uppercase tracking-wider text-slate-400">{name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

