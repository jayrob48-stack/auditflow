import { FileText, CheckCircle2, AlertTriangle, DollarSign } from "lucide-react";

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-4 bg-white rounded-2xl border border-slate-100 px-5 py-4 shadow-sm">
      <div className={`p-2.5 rounded-xl ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-xl font-bold text-slate-800 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

export default function StatsBar({ invoices }) {
  const total = invoices.length;
  const reviewed = invoices.filter(i => i.status === "reviewed").length;
  const flagged = invoices.filter(i => i.needs_review).length;
  const totalAmount = invoices.reduce((sum, i) => sum + (i.total_amount || 0), 0);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard icon={FileText} label="Total Invoices" value={total} accent="bg-slate-100 text-slate-600" />
      <StatCard icon={CheckCircle2} label="Reviewed" value={reviewed} accent="bg-emerald-50 text-emerald-600" />
      <StatCard icon={AlertTriangle} label="Needs Review" value={flagged} accent="bg-amber-50 text-amber-600" />
      <StatCard
        icon={DollarSign}
        label="Total Value"
        value={`$${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        accent="bg-blue-50 text-blue-600"
      />
    </div>
  );
}