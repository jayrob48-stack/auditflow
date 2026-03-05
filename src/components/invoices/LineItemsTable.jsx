import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function LineItemsTable({ items }) {
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-400">
        No line items extracted
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-100 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</TableHead>
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Qty</TableHead>
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Unit Price</TableHead>
            <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, idx) => (
            <TableRow key={idx} className="hover:bg-slate-50/50">
              <TableCell className="text-sm text-slate-700">{item.description || "—"}</TableCell>
              <TableCell className="text-right font-mono text-sm text-slate-600">
                {item.quantity != null ? item.quantity : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-slate-600">
                {item.unit_price != null ? `$${item.unit_price.toFixed(2)}` : "—"}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold text-slate-800">
                {item.amount != null ? `$${item.amount.toFixed(2)}` : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}