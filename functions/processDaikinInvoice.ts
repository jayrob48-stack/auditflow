/**
 * processDaikinInvoice
 *
 * Handles multi-invoice PDFs from Daikin Comfort Technologies Distribution.
 * Supports HN/HC/HI invoice number prefixes.
 *
 * Pipeline:
 *   A. Split multi-invoice PDF into individual invoice records (via LLM)
 *   B. Extract header fields per invoice
 *   C. Extract + normalise line items (filter Serial#, HAZMAT, Taxable lines)
 *   D. Extract totals (amount, tax%, freight, other, total_due)
 *   E. Math audit (line arithmetic + subtotal + grand total)
 *   F. Contract price audit (exact SKU match, case-insensitive)
 *   G. Duplicate detection
 *   H. Persist Invoice + AuditRun, send email alert on FLAG
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const VENDOR_NAME = 'Daikin Comfort Technologies Distribution, Inc.';

function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 10000) / 10000;
}

function round2(n) {
  return Math.round((n ?? 0) * 100) / 100;
}

// ── Extraction schemas ────────────────────────────────────────────────────────

const SPLIT_SCHEMA = {
  type: 'object',
  properties: {
    invoices: {
      type: 'array',
      description: 'One entry per distinct invoice found in the document',
      items: {
        type: 'object',
        properties: {
          invoice_number:   { type: 'string' },
          invoice_date:     { type: 'string' },
          due_date:         { type: 'string' },
          customer_number:  { type: 'string' },
          branch_number:    { type: 'string' },
          bill_to_name:     { type: 'string' },
          bill_to_address:  { type: 'string' },
          ship_to:          { type: 'string' },
          customer_po:      { type: 'string' },
          ship_date:        { type: 'string' },
          ship_via:         { type: 'string' },
          payment:          { type: 'string' },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                line_no:        { type: 'number' },
                sku:            { type: 'string' },
                description:    { type: 'string' },
                uom:            { type: 'string' },
                quantity:       { type: 'number' },
                unit_price:     { type: 'number' },
                extended_price: { type: 'number' },
              },
            },
          },
          amount:      { type: 'number' },
          tax_percent: { type: 'number' },
          tax_amount:  { type: 'number' },
          freight:     { type: 'number' },
          other:       { type: 'number' },
          total_due:   { type: 'number' },
        },
      },
    },
  },
};

// ── Audit helpers ─────────────────────────────────────────────────────────────

function auditInvoice(inv, contractMap) {
  const flags = [];
  let totalOvercharge = 0;
  const overchargedSkus = new Set();

  // Filter out noise lines (Serial #, HAZMAT, Taxable)
  const items = (inv.line_items || []).filter(item => {
    const d = String(item.description || '');
    return !d.includes('Serial Number =')
      && !d.toUpperCase().includes('HAZARDOUS MATERIAL')
      && !d.toLowerCase().startsWith('taxable:');
  }).map((item, idx) => ({
    line_no:        item.line_no ?? idx + 1,
    sku:            String(item.sku || '').trim(),
    description:    String(item.description || '').replace(/\s+/g, ' ').trim(),
    uom:            item.uom || null,
    quantity:       toNum(item.quantity),
    unit_price:     toNum(item.unit_price),
    extended_price: toNum(item.extended_price),
  }));

  // Step E — per-line arithmetic
  for (const item of items) {
    const { line_no, sku, quantity, unit_price, extended_price } = item;
    if (quantity != null && unit_price != null && extended_price != null) {
      const expected = round2(quantity * unit_price);
      const diff = Math.abs(expected - extended_price);
      if (diff > 0.02) {
        flags.push({
          type: 'ARITHMETIC',
          severity: 'HIGH',
          line_no,
          sku,
          message: `Line ${line_no} (${sku}): ${quantity} × ${unit_price} = ${expected} but extended is ${extended_price} (Δ${diff.toFixed(2)})`,
        });
      }
    }

    // Step F — contract price check
    if (sku) {
      const contract = contractMap[sku.toUpperCase()];
      if (contract && unit_price != null) {
        const contractPrice = contract.contract_price;
        if (unit_price > contractPrice + 0.01) {
          const diff = round2(unit_price - contractPrice);
          const pct = ((diff / contractPrice) * 100).toFixed(2);
          const overchargeAmt = quantity != null ? round2(diff * quantity) : diff;
          totalOvercharge = round2(totalOvercharge + overchargeAmt);
          overchargedSkus.add(sku);
          flags.push({
            type: 'OVERCHARGE',
            severity: 'HIGH',
            line_no,
            sku,
            contract_price: contractPrice,
            invoice_price: unit_price,
            difference: diff,
            percent_over: parseFloat(pct),
            overcharge_amount: overchargeAmt,
            message: `Line ${line_no} SKU ${sku}: invoice $${unit_price} vs contract $${contractPrice} (+${pct}%, Δ$${overchargeAmt.toFixed(2)})`,
          });
        }
      }
    }
  }

  // Subtotal check
  const amount   = toNum(inv.amount);
  const freight  = toNum(inv.freight) ?? 0;
  const other    = toNum(inv.other) ?? 0;
  const taxAmt   = toNum(inv.tax_amount) ?? 0;
  const totalDue = toNum(inv.total_due);

  const sumLines = round2(items.reduce((s, i) => s + (i.extended_price ?? 0), 0));

  if (amount != null && Math.abs(amount - sumLines) > 0.05) {
    flags.push({
      type: 'SUBTOTAL_MISMATCH',
      severity: 'HIGH',
      message: `Amount ${amount} ≠ sum of extended prices ${sumLines} (Δ${Math.abs(amount - sumLines).toFixed(2)})`,
    });
  }

  const computedTotal = round2((amount ?? sumLines) + freight + other + taxAmt);
  if (totalDue != null && Math.abs(totalDue - computedTotal) > 0.05) {
    flags.push({
      type: 'TOTAL_MISMATCH',
      severity: 'HIGH',
      message: `Total due ${totalDue} ≠ amount + freight + other + tax = ${computedTotal} (Δ${Math.abs(totalDue - computedTotal).toFixed(2)})`,
    });
  }

  const status = flags.length === 0 ? 'PASS' : 'FLAG';

  return {
    items,
    flags,
    status,
    totals: { amount, freight, other, tax_amount: taxAmt, total_due: totalDue, computed_total: computedTotal, sum_lines: sumLines },
    overcharge_summary: { count: overchargedSkus.size, total_overcharge: totalOvercharge },
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { file_url } = body;
    if (!file_url) return Response.json({ error: 'file_url required' }, { status: 400 });

    // ── Steps A–D: Split + extract all invoices via LLM vision ───────────────
    const extracted = await base44.integrations.Core.InvokeLLM({
      prompt: `You are processing a PDF from Daikin Comfort Technologies Distribution, Inc. (brands: Goodman, Amana, Daikin).
The PDF may contain multiple back-to-back invoices. A new invoice starts when you see "Invoice:" followed by an invoice ID (e.g. HN06164, HC12345, HI99999) AND "Invoice Date:".

For each distinct invoice found, extract:
- All header fields (invoice_number, invoice_date, due_date, customer_number, branch_number, bill_to_name, bill_to_address, ship_to, customer_po, ship_date, ship_via, payment)
- ALL line items from the item table: line_no, sku, description, uom, quantity, unit_price, extended_price
  EXCLUDE any line where description contains "Serial Number =" or "HAZARDOUS MATERIAL" or starts with "Taxable:"
- Totals section: amount, tax_percent, tax_amount, freight, other (may be negative), total_due

Normalize all dates to YYYY-MM-DD. Return null for missing fields. Numbers must be numeric (no $ signs).`,
      file_urls: [file_url],
      response_json_schema: SPLIT_SCHEMA,
    });

    const rawInvoices = extracted.invoices || [];
    if (rawInvoices.length === 0) {
      return Response.json({ success: true, message: 'No invoices found in document', results: [] });
    }

    // ── Load contract prices (build SKU → price map) ──────────────────────────
    const contracts = await base44.asServiceRole.entities.ContractPrice.filter({ vendor_name: VENDOR_NAME });
    const contractMap = {};
    for (const c of contracts) {
      if (c.sku) contractMap[c.sku.toUpperCase()] = c;
    }

    const results = [];

    for (const inv of rawInvoices) {
      // ── Audit (steps E + F) ───────────────────────────────────────────────
      const audit = auditInvoice(inv, contractMap);

      // ── Duplicate detection ───────────────────────────────────────────────
      const existing = await base44.asServiceRole.entities.Invoice.filter({
        vendor_name: VENDOR_NAME,
        invoice_number: inv.invoice_number,
      });
      if (existing.length > 0) {
        audit.flags.push({
          type: 'DUPLICATE',
          severity: 'HIGH',
          message: `Invoice #${inv.invoice_number} already exists (id: ${existing[0].id})`,
        });
        audit.status = 'FLAG';
      }

      // ── Build output structures (Step G) ──────────────────────────────────
      const invoice_json = {
        vendor:          VENDOR_NAME,
        invoice_number:  inv.invoice_number,
        invoice_date:    inv.invoice_date,
        due_date:        inv.due_date,
        customer_number: inv.customer_number,
        branch_number:   inv.branch_number,
        bill_to_name:    inv.bill_to_name,
        bill_to_address: inv.bill_to_address,
        ship_to:         inv.ship_to,
        customer_po:     inv.customer_po,
        ship_date:       inv.ship_date,
        ship_via:        inv.ship_via,
        payment:         inv.payment,
        items:           audit.items,
        totals:          audit.totals,
      };

      const audit_report_json = {
        vendor:           VENDOR_NAME,
        invoice_number:   inv.invoice_number,
        invoice_date:     inv.invoice_date,
        status:           audit.status,
        flags:            audit.flags,
        totals:           audit.totals,
        overcharge_summary: audit.overcharge_summary,
      };

      // ── Persist Invoice ───────────────────────────────────────────────────
      let savedInvoice = null;
      if (existing.length === 0) {
        savedInvoice = await base44.asServiceRole.entities.Invoice.create({
          vendor_name:    VENDOR_NAME,
          invoice_number: inv.invoice_number,
          invoice_date:   inv.invoice_date,
          due_date:       inv.due_date,
          bill_to:        inv.bill_to_name,
          bill_to_address: inv.bill_to_address,
          po_number:      inv.customer_po,
          payment_terms:  inv.payment,
          subtotal:       audit.totals.amount,
          tax_amount:     audit.totals.tax_amount || null,
          shipping:       audit.totals.freight || null,
          total_amount:   audit.totals.total_due,
          line_items:     audit.items,
          needs_review:   audit.status === 'FLAG',
          review_notes:   audit.flags.map(f => f.message).join('\n'),
          status:         audit.status === 'PASS' ? 'extracted' : 'flagged',
          file_url,
          raw_json:       JSON.stringify(invoice_json),
        });
      }

      // ── Persist AuditRun ──────────────────────────────────────────────────
      const auditRun = await base44.asServiceRole.entities.AuditRun.create({
        invoice_id:       savedInvoice?.id || existing[0]?.id || null,
        invoice_number:   inv.invoice_number,
        invoice_date:     inv.invoice_date,
        vendor:           VENDOR_NAME,
        status:           audit.status,
        flags:            audit.flags,
        total_overcharge: audit.overcharge_summary.total_overcharge,
        items_affected:   audit.overcharge_summary.count,
        computed_subtotal: audit.totals.amount,
        computed_total:   audit.totals.computed_total,
        sum_lines:        audit.totals.sum_lines,
        audit_json:       JSON.stringify(audit_report_json, null, 2),
        alert_sent:       false,
      });

      // ── Email alert if flagged ────────────────────────────────────────────
      if (audit.status === 'FLAG') {
        const summary = [
          `🚨 Daikin Invoice Audit Alert`,
          `Invoice #: ${inv.invoice_number}`,
          `Date: ${inv.invoice_date}`,
          `Vendor: ${VENDOR_NAME}`,
          `Status: FLAG`,
          `Total Overcharge: $${audit.overcharge_summary.total_overcharge.toFixed(2)}`,
          `Items Affected: ${audit.overcharge_summary.count}`,
          `Flags (${audit.flags.length}):`,
          ...audit.flags.map(f => `  [${f.severity || 'HIGH'}] ${f.type}: ${f.message}`),
        ].join('\n');

        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: user.email,
            subject: `⚠️ Invoice Audit FLAG — ${VENDOR_NAME} #${inv.invoice_number}`,
            body: `<pre style="font-family:monospace;font-size:13px">${summary}</pre>`,
          });
          await base44.asServiceRole.entities.AuditRun.update(auditRun.id, {
            alert_sent: true,
            alert_channels: ['email'],
          });
        } catch (e) {
          console.error('Email alert failed:', e.message);
        }
      }

      results.push({
        invoice_number: inv.invoice_number,
        audit_run_id:   auditRun.id,
        status:         audit.status,
        invoice_json,
        audit_report_json,
      });
    }

    return Response.json({ success: true, invoices_processed: results.length, results });

  } catch (error) {
    console.error('processDaikinInvoice error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});