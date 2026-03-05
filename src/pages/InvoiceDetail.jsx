import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, CheckCircle2, AlertTriangle, FileText, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import AuditReport from "@/components/invoices/AuditReport";

import StatusBadge from "@/components/invoices/StatusBadge";
import InvoiceMetaGrid from "@/components/invoices/InvoiceMetaGrid";
import LineItemsTable from "@/components/invoices/LineItemsTable";

export default function InvoiceDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const invoiceId = urlParams.get("id");
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [auditReport, setAuditReport] = useState(null);
  const [isAuditing, setIsAuditing] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: async () => {
      const list = await base44.entities.Invoice.filter({ id: invoiceId });
      return list[0];
    },
    enabled: !!invoiceId,
    onSuccess: (data) => {
      if (data?.review_notes) setNotes(data.review_notes);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.Invoice.update(invoiceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const markReviewed = () => {
    updateMutation.mutate({ status: "reviewed", needs_review: false, review_notes: notes });
    toast.success("Invoice marked as reviewed");
  };

  const markFlagged = () => {
    updateMutation.mutate({ status: "flagged", needs_review: true, review_notes: notes });
    toast.success("Invoice flagged for review");
  };

  const runAudit = async () => {
    if (!invoice) return;
    setIsAuditing(true);
    setAuditReport(null);
    try {
      const allInvoices = await base44.entities.Invoice.list("-created_date", 500);
      const history_index = allInvoices
        .filter(i => i.id !== invoice.id)
        .map(i => ({
          vendor_name: i.vendor_name,
          invoice_number: i.invoice_number,
          invoice_date: i.invoice_date,
          total: i.total_amount,
        }));

      const res = await base44.functions.invoke("auditInvoice", {
        invoice_json: invoice,
        history_index,
      });
      setAuditReport(res.data);
    } catch (err) {
      toast.error("Audit failed: " + err.message);
    } finally {
      setIsAuditing(false);
    }
  };

  if (isLoading || !invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <p className="text-slate-400 text-sm animate-pulse">Loading invoice…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {/* Top nav */}
        <div className="flex items-center justify-between">
          <Link
            to={createPageUrl("Dashboard")}
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>
          <StatusBadge status={invoice.status} />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {invoice.vendor_name || "Unknown Vendor"}
            </h1>
            <p className="text-sm text-slate-400 mt-1 font-mono">
              {invoice.invoice_number || "No invoice number"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-slate-900 font-mono">
              {invoice.total_amount != null
                ? `$${invoice.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                : "—"}
            </p>
            <p className="text-xs text-slate-400 mt-1">{invoice.currency || ""}</p>
          </div>
        </div>

        {/* Review alert */}
        {invoice.needs_review && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">This invoice needs review</p>
              {invoice.review_notes && (
                <p className="text-sm text-amber-700 mt-1">{invoice.review_notes}</p>
              )}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-5">Invoice Details</h2>
          <InvoiceMetaGrid invoice={invoice} />
        </div>

        {/* Line items */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-5">Line Items</h2>
          <LineItemsTable items={invoice.line_items} />
        </div>

        {/* Source file */}
        {invoice.file_url && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <a
              href={invoice.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
            >
              <FileText className="h-4 w-4" />
              View Original PDF
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {/* Review actions */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Review Actions</h2>
          <Textarea
            placeholder="Add notes about this invoice…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[80px] resize-none"
          />
          <div className="flex gap-3">
            <Button
              onClick={markReviewed}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              disabled={updateMutation.isPending}
            >
              <CheckCircle2 className="h-4 w-4" /> Mark Reviewed
            </Button>
            <Button
              onClick={markFlagged}
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50 gap-2"
              disabled={updateMutation.isPending}
            >
              <AlertTriangle className="h-4 w-4" /> Flag for Review
            </Button>
          </div>
        </div>

        {/* Raw JSON */}
        {invoice.raw_json && (
          <details className="bg-white rounded-2xl border border-slate-100 shadow-sm">
            <summary className="p-5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 transition-colors">
              Raw Extracted JSON
            </summary>
            <div className="px-5 pb-5">
              <pre className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                {invoice.raw_json}
              </pre>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}