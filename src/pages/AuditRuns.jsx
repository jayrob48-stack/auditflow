import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ExternalLink, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function AuditRuns() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["audit-runs"],
    queryFn: () => base44.entities.AuditRun.list("-created_date", 100),
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Audit Runs</h1>
          <p className="text-sm text-slate-400 mt-1">History of all automated invoice audits</p>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
            <p className="text-slate-400 text-sm animate-pulse">Loading audit runs…</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Invoice #</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Overcharge</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Items</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Flags</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-400 py-12 text-sm">
                      No audit runs yet
                    </TableCell>
                  </TableRow>
                )}
                {runs.map(run => (
                  <TableRow key={run.id} className="group hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-mono text-sm font-semibold text-slate-700">{run.invoice_number || "—"}</TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {run.invoice_date ? (() => { try { return format(new Date(run.invoice_date), "MMM d, yyyy"); } catch { return run.invoice_date; } })() : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700 max-w-[180px] truncate">{run.vendor || "—"}</TableCell>
                    <TableCell>
                      {run.status === "PASS" ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1.5">
                          <ShieldCheck className="h-3 w-3" /> PASS
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1.5">
                          <ShieldAlert className="h-3 w-3" /> FLAG
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-red-600">
                      {(run.total_overcharge ?? 0) > 0 ? `$${run.total_overcharge.toFixed(2)}` : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm text-slate-500">{run.items_affected ?? 0}</TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-400">{(run.flags || []).length} flag{run.flags?.length !== 1 ? "s" : ""}</span>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={createPageUrl("AuditRunDetail") + `?id=${run.id}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-600"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}