/**
 * FeeCharts.tsx — the Fees tab's recharts visualisations, split into their own
 * (lazy-loaded) chunk.
 *
 * PERF: recharts is ~100 KB gzipped and was bundled into the AdminFees tab
 * chunk — so an admin opening Structures / Vouchers / Payments (no charts on
 * any of them) still downloaded the whole charting library before the tab
 * could paint. AdminFees now lazy-loads ONLY the chart components below via
 * React.lazy, so the chart library arrives on demand with a skeleton
 * placeholder (Dashboard/Reports render their stat cards and tables first).
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend, PieChart, Pie,
} from "recharts";

// Custom Tooltip for Charts (moved from AdminFees.tsx — unchanged)
export const CustomTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border/60 rounded-xl p-2.5 shadow-lg text-xs">
      <p className="font-bold text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill }}>
          {p.name}: <strong>Rs. {Number(p.value).toLocaleString()}</strong>
        </p>
      ))}
    </div>
  );
};

export interface AgingDatum { name: string; value: number; fill: string }
export interface ClassCollectionDatum { class: string; collected: number; outstanding: number }
export interface MonthlyCollectionDatum { month: number; collected: number; outstanding: number }
export interface ClassSummaryDatum { class: string; total_collected: number; total_outstanding: number }

/** Dashboard → "Aging Analysis" donut. */
export function AgingPie({ data }: { data: AgingDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
        <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
          {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
        </Pie>
        <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Dashboard → "Class-wise Collection" bars. */
export function ClassCollectionBar({ data }: { data: ClassCollectionDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="class" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip content={<CustomTip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="collected" name="Collected" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Bar dataKey="outstanding" name="Outstanding" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Reports → "Monthly Collection" bars. */
export function MonthlyCollectionBar({ data, monthLabel }: { data: MonthlyCollectionDatum[]; monthLabel: (m: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(v: number) => monthLabel(v)} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip content={<CustomTip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="collected" name="Collected" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Bar dataKey="outstanding" name="Outstanding" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Reports → "Class-wise Collection" bars (per-class colours). */
export function ClassSummaryBar({ data, classColors }: { data: ClassSummaryDatum[]; classColors: Record<string, string> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="class" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip content={<CustomTip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="total_collected" name="Collected" radius={[4, 4, 0, 0]}>
          {data.map((c, i) => <Cell key={i} fill={classColors[c.class] || "#6366f1"} />)}
        </Bar>
        <Bar dataKey="total_outstanding" name="Outstanding" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
