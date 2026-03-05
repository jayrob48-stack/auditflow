/**
 * processLennoxInvoice
 *
 * Pipeline:
 *   1. Receive file_url (uploaded PDF)
 *   2. Detect document type (invoice vs statement)
 *   3. Extract header fields + line items + charges
 *   4. Normalise line items (filter "Serial #" lines)
 *   5. Load Lennox contract prices
 *   6. Math audit: qty × unit_price ≈ extended_price
 *   7. Total check: sum(lines) + surcharge + freight = total
 *   8. Contract price overcharge check
 *   9. Duplicate detection
 *  10. Persist Invoice + AuditRun, email alert if flagged
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const VENDOR_NAME = 'Lennox Industries';

function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 10000) / 10000;
}

function round2(n) {
  return Math.round((n ?? 0) * 100) / 100;
}

// ── main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { file_url } = body;
    if (!file_url) return Response.json({ error: 'file_url required' }, { status: 400 });

    // ── STEP 1: Classify document type ───────────────────────────────────────
    const classifyResult = await base44.integrations.Core.InvokeLLM({
      prompt: `Look at this document carefully.
If the document contains BOTH of these indicators: "STATEMENT DATE" and "AGING" (or an aging table showing current/past-due buckets), classify it as a statement.
Otherwise classify it as an invoice.
Respond with JSON only: { "document_type": "invoice" | "statement" }`,
      file_urls: [file_url],
      response_json_schema: {
        type: 'object',
        properties: { document_type: { type: 'string' } },
      },
    });

    if (classifyResult.document_type === 'statement') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'Document classified as statement — skipped',
        document_type: 'statement',
      });
    }

    // ── STEP 2+3: Extract header + line items + charges ───────────────────────
    const EXTRACTION_SCHEMA = {
      type: 'object',
      properties: {
        invoice_number:    { type: 'string' },
        invoice_date:      { type: 'string' },
        customer_number:   { type: 'string' },
        order_number:      { type: 'string' },
        delivery_number:   { type: 'string' },
        payment_terms:     { type: 'string' },
        sales_office:      { type: 'string' },
        net_price:         { type: 'number' },
        surcharge:         { type: 'number' },
        freight:           { type: 'number' },
        net_after_surcharges: { type: 'number' },
        invoice_total:     { type: 'number' },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              material_number: { type: 'string' },
              description:     { type: 'string' },
              quantity:        { type: 'number' },
              unit_price:      { type: 'number' },
              extended_price:  { type: 'number' },
            },
          },
        },
      },
    };

    const extracted = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an invoice parser for Lennox Industries invoices.
Extract all header fields and every line item from the line item table.
IMPORTANT: Skip any line items where the description contains "Serial #" — do not include those rows.
For invoice_total use the final total amount due on the document.
Normalize all dates to YYYY-MM-DD. Return null for missing fields.
For charges, extract: Net Price, Surcharge, Freight, Net After Surcharges as separate numeric fields.`,
      file_urls: [file_url],
      response_json_schema: EXTRACTION_SCHEMA,
    });

    // ── STEP 4: Normalise line items ─────────────────────────────────────────
    const lineItems = (extracted.line_items || [])
      .filter(item => {
        const desc = String(item.description || '');
        return !desc.includes('Serial #');
      })
      .map((item, idx) => ({
        line_no:         idx + 1,
        material_number: String(item.material_number || '').trim(),
        description:     String(item.description || '').replace(/\s+/g, ' ').trim(),
        quantity:        toNum(item.quantity),
        unit_price:      toNum(item.unit_price),
        extended_price:  toNum(item.extended_price),
      }));

    const surcharge    = toNum(extracted.surcharge) ?? 0;
    const freight      = toNum(extracted.freight) ?? 0;
    const invoiceTotal = toNum(extracted.invoice_total);

    const flags = [];
    let totalOvercharge = 0;
    const affectedLines = new Set();

    // ── STEP 5: Arithmetic audit per line (qty × unit_price ≈ extended) ──────
    for (const item of lineItems) {
      const { line_no, quantity, unit_price, extended_price } = item;
      if (quantity != null && unit_price != null && extended_price != null) {
        const expected = round2(quantity * unit_price);
        const diff = Math.abs(expected - extended_price);
        if (diff > 0.02) {
          flags.push({
            type: 'ARITHMETIC',
            severity: 'HIGH',
            line_no,
            message: `Line ${line_no}: ${quantity} × ${unit_price} = ${expected} but extended_price is ${extended_price} (Δ${diff.toFixed(2)})`,
          });
          affectedLines.add(line_no);
        }
      }
    }

    // ── STEP 6+7: Total check ─────────────────────────────────────────────────
    const sumLines     = round2(lineItems.reduce((s, i) => s + (i.extended_price ?? 0), 0));
    const expectedTotal = round2(sumLines + surcharge + freight);

    if (invoiceTotal != null && Math.abs(invoiceTotal - expectedTotal) > 0.05) {
      flags.push({
        type: 'TOTAL_MISMATCH',
        severity: 'HIGH',
        message: `Invoice total ${invoiceTotal} ≠ sum_lines(${sumLines}) + surcharge(${surcharge}) + freight(${freight}) = ${expectedTotal} (Δ${Math.abs(invoiceTotal - expectedTotal).toFixed(2)})`,
      });
    }

    // ── STEP 8: Contract price check ─────────────────────────────────────────
    const contracts = await base44.asServiceRole.entities.ContractPrice.filter({ vendor_name: VENDOR_NAME });

    for (const item of lineItems) {
      const { line_no, material_number, description, unit_price, quantity } = item;

      // Match by material_number first, then fall back to description
      let hit = contracts.find(c => c.sku && c.sku.trim() === material_number);
      if (!hit) hit = contracts.find(c => c.product_name?.trim() === description);

      if (hit && unit_price != null) {
        const contractPrice = hit.contract_price;
        if (unit_price > contractPrice + 0.01) {
          const diff = round2(unit_price - contractPrice);
          const pct  = ((diff / contractPrice) * 100).toFixed(2);
          const overchargeAmt = quantity != null ? round2(diff * quantity) : diff;
          totalOvercharge += overchargeAmt;
          affectedLines.add(line_no);
          flags.push({
            type: 'OVERCHARGE',
            severity: 'HIGH',
            line_no,
            material_number,
            item_description: description,
            contract_price: contractPrice,
            invoice_price: unit_price,
            difference: diff,
            percent_over: parseFloat(pct),
            message: `Line ${line_no}: "${description}" (${material_number}) — invoice $${unit_price} vs contract $${contractPrice} (+${pct}%, Δ$${overchargeAmt.toFixed(2)})`,
          });
        }
      }
    }

    totalOvercharge = round2(totalOvercharge);
    const status = flags.length === 0 ? 'PASS' : 'FLAG';

    // ── STEP 9: Duplicate detection ───────────────────────────────────────────
    const existing = await base44.asServiceRole.entities.Invoice.filter({
      vendor_name: VENDOR_NAME,
      invoice_number: extracted.invoice_number,
    });
    if (existing.length > 0) {
      flags.push({
        type: 'DUPLICATE',
        severity: 'HIGH',
        message: `Invoice #${extracted.invoice_number} from ${VENDOR_NAME} already exists (id: ${existing[0].id})`,
      });
    }

    // ── Build structured output (Step 8 spec) ────────────────────────────────
    const auditReport = {
      vendor:          VENDOR_NAME,
      invoice_number:  extracted.invoice_number,
      invoice_date:    extracted.invoice_date,
      customer_number: extracted.customer_number,
      order_number:    extracted.order_number,
      delivery_number: extracted.delivery_number,
      payment_terms:   extracted.payment_terms,
      sales_office:    extracted.sales_office,
      items:           lineItems,
      net_price:       toNum(extracted.net_price),
      surcharge,
      freight,
      net_after_surcharges: toNum(extracted.net_after_surcharges),
      total:           invoiceTotal,
      expected_total:  expectedTotal,
      sum_lines:       sumLines,
      status,
      flags,
      total_overcharge: totalOvercharge,
      items_affected:  affectedLines.size,
    };

    // ── Persist Invoice ───────────────────────────────────────────────────────
    let savedInvoice = null;
    if (existing.length === 0) {
      savedInvoice = await base44.asServiceRole.entities.Invoice.create({
        vendor_name:    VENDOR_NAME,
        invoice_number: extracted.invoice_number,
        invoice_date:   extracted.invoice_date,
        payment_terms:  extracted.payment_terms,
        po_number:      extracted.order_number,
        subtotal:       sumLines,
        tax_amount:     null,
        shipping:       freight || null,
        total_amount:   invoiceTotal,
        line_items:     lineItems,
        needs_review:   status === 'FLAG',
        review_notes:   flags.map(f => f.message).join('\n'),
        status:         status === 'PASS' ? 'extracted' : 'flagged',
        file_url,
        raw_json:       JSON.stringify(extracted),
      });
    }

    // ── Persist AuditRun ──────────────────────────────────────────────────────
    const auditRun = await base44.asServiceRole.entities.AuditRun.create({
      invoice_id:       savedInvoice?.id || existing[0]?.id || null,
      invoice_number:   extracted.invoice_number,
      invoice_date:     extracted.invoice_date,
      vendor:           VENDOR_NAME,
      status,
      flags,
      total_overcharge: totalOvercharge,
      items_affected:   affectedLines.size,
      computed_subtotal: sumLines,
      computed_total:   expectedTotal,
      sum_lines:        sumLines,
      audit_json:       JSON.stringify(auditReport, null, 2),
      alert_sent:       false,
    });

    // ── Email alert if flagged ────────────────────────────────────────────────
    if (status === 'FLAG') {
      const summary = [
        `🚨 Lennox Invoice Audit Alert`,
        `Invoice #: ${extracted.invoice_number}`,
        `Date: ${extracted.invoice_date}`,
        `Vendor: ${VENDOR_NAME}`,
        `Status: ${status}`,
        `Total Overcharge: $${totalOvercharge.toFixed(2)}`,
        `Items Affected: ${affectedLines.size}`,
        `Flags (${flags.length}):`,
        ...flags.map(f => `  [${f.severity || 'HIGH'}] ${f.type}: ${f.message}`),
      ].join('\n');

      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          subject: `⚠️ Invoice Audit FLAG — ${VENDOR_NAME} #${extracted.invoice_number}`,
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

    return Response.json({
      success: true,
      audit_run_id: auditRun.id,
      document_type: 'invoice',
      report: auditReport,
    });
  } catch (error) {
    console.error('processLennoxInvoice error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});