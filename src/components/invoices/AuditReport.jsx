import { AlertTriangle, CheckCircle2, Info, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const severityConfig = {
  HIGH: { icon: ShieldAlert, className: "bg-red-50 border-red-200 text-red-800", iconClass: "text-red-500", label: "High" },
  MEDIUM: { icon: AlertTriangle, className: "bg-amber-50 border-amber-200 text-amber-800", iconClass: "text-amber-500", label: "Medium" },
  LOW: { icon: Info, className: "bg-blue-50 border-blue-200 text-blue-800", iconClass: "text-blue-500", label: "Low" },
};

const typeLabels = {
  ARITHMETIC_LINE: "Line Math",
  ARITHMETIC_SUBTOTAL: "Subtotal Math",
  ARITHMETIC_TOTAL: "Total Math",
  DUPLICATE_INVOICE: "Duplicate",
  CONTRACT_OVERAGE: "Contract Overage",
  UNUSUAL_CHARGE: "Unusual Charge",
};

function FlagItem({ flag }) {
  const config = severityConfig[flag.severity] || severityConfig.LOW;
  const Icon = config.icon;

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", config.className)}>
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", config.iconClass)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider opacity-70">
            {typeLabels[flag.type] || flag.type}
          </span>
          <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full", {
            "bg-red-200 text-red-800": flag.severity === "HIGH",
            "bg-amber-200 text-amber-800": flag.severity === "MEDIUM",
            "bg-blue-200 text-blue-800": flag.severity === "LOW",
          })}>
            {config.label}
          </span>
        </div>
        <p className="text-sm mt-0.5 leading-snug">{flag.message}</p>
      </div>
    </div>
  );
}

export default function AuditReport({ report, isRunning }) {
  if (isRunning) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <div className="inline-flex items-center gap-2 text-sm text-slate-400 animate-pulse">
          <ShieldAlert className="h-4 w-4 animate-spin" />
          Running audit…
        </div>
      </div>
    );
  }

  if (!report) return null;

  const isPassing = report.status === "PASS";

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={cn(
        "flex items-center justify-between gap-4 rounded-2xl border px-6 py-4",
        isPassing
          ? "bg-emerald-50 border-emerald-200"
          : "bg-red-50 border-red-200"
      )}>
        <div className="flex items-center gap-3">
          {isPassing
            ? <ShieldCheck className="h-6 w-6 text-emerald-600" />
            : <ShieldAlert className="h-6 w-6 text-red-500" />
          }
          <div>
            <p className={cn("font-bold text-lg", isPassing ? "text-emerald-800" : "text-red-800")}>
              Audit {report.status}
            </p>
            <p className={cn("text-sm", isPassing ? "text-emerald-700" : "text-red-700")}>
              {report.recommended_action}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={cn("text-2xl font-bold font-mono", isPassing ? "text-emerald-700" : "text-red-600")}>
            {report.flags?.length ?? 0}
          </p>
          <p className="text-xs text-slate-500">flag{report.flags?.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Computed values */}
      {report.computed && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Computed Totals</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { label: "Sum of Lines", value: report.computed.sum_lines },
              { label: "Computed Subtotal", value: report.computed.computed_subtotal },
              { label: "Computed Total", value: report.computed.computed_total },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-[11px] text-slate-400 uppercase tracking-wider">{label}</p>
                <p className="text-base font-bold font-mono text-slate-800 mt-1">
                  ${(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flags */}
      {report.flags?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Audit Flags</p>
          {report.flags.map((flag, idx) => (
            <FlagItem key={idx} flag={flag} />
          ))}
        </div>
      )}
    </div>
  );
}