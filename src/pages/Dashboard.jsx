import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import UploadZone from "@/components/invoices/UploadZone";
import StatsBar from "@/components/invoices/StatsBar";
import InvoiceTable from "@/components/invoices/InvoiceTable";

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    vendor_name: { type: "string" },
    invoice_number: { type: "string" },
    invoice_date: { type: "string" },
    due_date: { type: "string" },
    subtotal: { type: "number" },
    tax_amount: { type: "number" },
    total_amount: { type: "number" },
    currency: { type: "string" },
    vendor_address: { type: "string" },
    bill_to: { type: "string" },
    bill_to_address: { type: "string" },
    payment_terms: { type: "string" },
    po_number: { type: "string" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          amount: { type: "number" }
        }
      }
    },
    needs_review: { type: "boolean" },
    review_notes: { type: "string" },
    confidence_score: { type: "number" }
  }
};

const SYSTEM_PROMPT = `You are an invoice audit engine. Extract invoice data from the provided document and produce a strict JSON object matching the schema.

Rules:
- If a field is missing, use null.
- Do not guess invoice numbers, totals, taxes, or quantities.
- Normalize money to decimals (e.g., 1234.56). No dollar signs or commas.
- Normalize dates to YYYY-MM-DD when possible; otherwise keep as raw string.
- Extract line items exactly as shown. If a line is ambiguous, put it in review_notes and still include best-effort extraction.
- If you cannot reliably parse line items, set line_items to [] and set needs_review to true with an explanation in review_notes.
- Set confidence_score from 0 to 100 based on how confident you are in the extraction.
- Be conservative — flag anything uncertain with needs_review: true.`;

export default function Dashboard() {
  const [isUploading, setIsUploading] = useState(false);
  const queryClient = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => base44.entities.Invoice.list("-created_date", 100),
  });

  const handleUpload = async (files) => {
    setIsUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });

        const extracted = await base44.integrations.Core.InvokeLLM({
          prompt: SYSTEM_PROMPT + "\n\nExtract invoice data from the attached document.",
          file_urls: [file_url],
          response_json_schema: EXTRACTION_SCHEMA,
        });

        await base44.entities.Invoice.create({
          ...extracted,
          file_url,
          status: extracted.needs_review ? "flagged" : "extracted",
          raw_json: JSON.stringify(extracted, null, 2),
        });
      }

      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(`${files.length} invoice${files.length > 1 ? "s" : ""} processed`);
    } catch (err) {
      toast.error("Failed to process invoice: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Invoice Audit Engine</h1>
          <p className="text-sm text-slate-400 mt-1">Upload vendor invoices to extract and audit data automatically</p>
        </div>

        {/* Upload */}
        <UploadZone onUpload={handleUpload} isUploading={isUploading} />

        {/* Stats */}
        <StatsBar invoices={invoices} />

        {/* Table */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Recent Invoices</h2>
          {isLoading ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
              <p className="text-slate-400 text-sm animate-pulse">Loading invoices…</p>
            </div>
          ) : (
            <InvoiceTable invoices={invoices} />
          )}
        </div>
      </div>
    </div>
  );
}