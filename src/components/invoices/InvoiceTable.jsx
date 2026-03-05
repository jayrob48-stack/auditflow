import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "./StatusBadge";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function InvoiceTable({ invoices }) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Invoice.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice deleted");
    },
  });

  if (invoices.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
        <p className="text-slate-400 text-sm">No invoices yet. Upload a PDF to get started.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</TableHead>
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Invoice #</TableHead>
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</TableHead>
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Amount</TableHead>
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</TableHead>
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => (
            <TableRow key={inv.id} className="group hover:bg-slate-50/50 transition-colors">
              <TableCell className="font-medium text-slate-800">{inv.vendor_name || "—"}</TableCell>
              <TableCell className="font-mono text-xs text-slate-500">{inv.invoice_number || "—"}</TableCell>
              <TableCell className="text-sm text-slate-500">
                {inv.invoice_date ? format(new Date(inv.invoice_date), "MMM d, yyyy") : "—"}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold text-slate-800">
                {inv.total_amount != null
                  ? `$${inv.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                  : "—"}
              </TableCell>
              <TableCell><StatusBadge status={inv.status} /></TableCell>
              <TableCell>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    to={createPageUrl("InvoiceDetail") + `?id=${inv.id}`}
                    className="text-slate-400 hover:text-blue-600"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-red-500"
                    onClick={() => {
                      if (confirm(`Delete invoice ${inv.invoice_number || inv.id}?`)) {
                        deleteMutation.mutate(inv.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}