import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Download, ShieldCheck, ShieldAlert, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import LineItemsTable from "@/components/invoices/LineItemsTable";

const severityConfig = {
  HIGH: "bg-red-50 border-red-200 text-red-800",
  MEDIUM: "bg-amber-50 border-amber-200 text-amber-800",
  LOW: "bg-blue-50 border-blue-200 text-blue-800",
};

function FlagRow({ flag }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", severityConfig[flag.severity] || severityConfig.LOW)}>
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 opacity-60" />
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-xs font-bold uppercase tracking-wider opacity-60">{flag.type}</span>
          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-black/10">{flag.severity}</span>
        </div>
        <p className="text-sm leading-snug">{flag.message}</p>
        {flag.type === "OVERCHARGE" && flag.contract_price != null && (
          <div className="mt-1 text-xs opacity-70 flex gap-4 flex-wrap">
            <span>Contract: ${flag.contract_price}</span>
            <span>Invoice: ${flag.invoice_price}</span>
            <span>Δ ${flag.difference?.toFixed(2)}</span>
            <span>+{flag.percent_over}%</span>
            {flag.match_method && <span>Match: {flag.match_method}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuditRunDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const runId = urlParams.get("id");
  const [downloading, setDownloading] = useState(null);

  const { data: run, isLoading } = useQuery({
    queryKey: ["audit-run", runId],
    queryFn: async () => {
      const list = await base44.entities.AuditRun.filter({ id: runId });
      return list[0];
    },
    enabled: !!runId,
  });

  const download = async (fmt) => {
    setDownloading(fmt);
    try {
      const res = await base44.functions.invoke("exportAuditReport", { audit_run_id: runId, format: fmt });
      const blob = new Blob(
        [typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2)],
        { type: fmt === "csv" ? "text/csv" : "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit_report_${run?.invoice_number || runId}.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading || !run) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <p className="text-slate-400 text-sm animate-pulse">Loading audit run…</p>
      </div>
    );
  }

  const flags = run.flags || [];
  const report = run.audit_json ? JSON.parse(run.audit_json) : null;
  const lineItems = report?.line_items || [];
  const isPassing = run.status === "PASS";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <Link to={createPageUrl("AuditRuns")} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to Audit Runs
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => download("json")} disabled={!!downloading} className="gap-1.5 text-xs">
              <Download className="h-3 w-3" /> {downloading === "json" ? "…" : "JSON"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => download("csv")} disabled={!!downloading} className="gap-1.5 text-xs">
              <Download className="h-3 w-3" /> {downloading === "csv" ? "…" : "CSV"}
            </Button>
          </div>
        </div>

        {/* Status */}
        <div className={cn("flex items-center justify-between gap-4 rounded-2xl border px-6 py-5", isPassing ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200")}>
          <div className="flex items-center gap-3">
            {isPassing ? <ShieldCheck className="h-7 w-7 text-emerald-600" /> : <ShieldAlert className="h-7 w-7 text-red-500" />}
            <div>
              <p className={cn("font-bold text-xl", isPassing ? "text-emerald-800" : "text-red-800")}>
                Audit {run.status}
              </p>
              <p className={cn("text-sm", isPassing ? "text-emerald-700" : "text-red-700")}>
                {run.vendor} — Invoice #{run.invoice_number} — {run.invoice_date}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            {(run.total_overcharge ?? 0) > 0 && (
              <>
                <p className="text-2xl font-bold font-mono text-red-600">${run.total_overcharge.toFixed(2)}</p>
                <p className="text-xs text-slate-500">total overcharge</p>
              </>
            )}
          </div>
        </div>

        {/* Computed totals */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Computed Totals</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { label: "Sum of Lines", value: run.sum_lines },
              { label: "Computed Subtotal", value: run.computed_subtotal },
              { label: "Computed Total", value: run.computed_total },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-[11px] text-slate-400 uppercase tracking-wider">{label}</p>
                <p className="text-lg font-bold font-mono text-slate-800 mt-1">
                  ${(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Flags */}
        {flags.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Audit Flags ({flags.length})
            </p>
            {flags.map((flag, idx) => <FlagRow key={idx} flag={flag} />)}
          </div>
        )}

        {/* Line items */}
        {lineItems.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Line Items</p>
            <LineItemsTable items={lineItems.map(i => ({
              description: i.description,
              quantity: i.ship_qty,
              unit_price: i.unit_price,
              amount: i.extended_price,
            }))} />
          </div>
        )}

        {/* Raw JSON */}
        {run.audit_json && (
          <details className="bg-white rounded-2xl border border-slate-100 shadow-sm">
            <summary className="p-5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 transition-colors">
              Raw Audit JSON
            </summary>
            <div className="px-5 pb-5">
              <pre className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96">
                {run.audit_json}
              </pre>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}