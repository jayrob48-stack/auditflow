import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLink } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";

export default function InvoiceTable({ invoices }) {
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
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-10"></TableHead>
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
                <Link
                  to={createPageUrl("InvoiceDetail") + `?id=${inv.id}`}
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
  );
}