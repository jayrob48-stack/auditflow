import { format } from "date-fns";

function MetaField({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-medium text-slate-700">{value || "—"}</p>
    </div>
  );
}

export default function InvoiceMetaGrid({ invoice }) {
  const fmtDate = (d) => {
    if (!d) return null;
    try { return format(new Date(d), "MMM d, yyyy"); } catch { return d; }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
      <MetaField label="Vendor" value={invoice.vendor_name} />
      <MetaField label="Invoice #" value={invoice.invoice_number} />
      <MetaField label="Invoice Date" value={fmtDate(invoice.invoice_date)} />
      <MetaField label="Due Date" value={fmtDate(invoice.due_date)} />
      <MetaField label="PO Number" value={invoice.po_number} />
      <MetaField label="Payment Terms" value={invoice.payment_terms} />
      <MetaField label="Currency" value={invoice.currency} />
      <MetaField label="Bill To" value={invoice.bill_to} />
      <MetaField label="Vendor Address" value={invoice.vendor_address} />
      <MetaField label="Bill To Address" value={invoice.bill_to_address} />
      <MetaField
        label="Subtotal"
        value={invoice.subtotal != null ? `$${invoice.subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null}
      />
      <MetaField
        label="Tax"
        value={invoice.tax_amount != null ? `$${invoice.tax_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null}
      />
      <MetaField
        label="Total"
        value={invoice.total_amount != null ? `$${invoice.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null}
      />
      <MetaField
        label="Confidence"
        value={invoice.confidence_score != null ? `${invoice.confidence_score}%` : null}
      />
    </div>
  );
}