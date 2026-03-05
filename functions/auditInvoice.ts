import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { invoice_json, contract_prices = [], history_index = [] } = await req.json();

    if (!invoice_json) {
      return Response.json({ error: 'invoice_json is required' }, { status: 400 });
    }

    const flags = [];
    const UNUSUAL_KEYWORDS = ['fee', 'surcharge', 'fuel', 'service', 'freight', 'handling', 'misc'];

    const toNum = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));

    // ── 1. Arithmetic Validation ────────────────────────────────────────────────
    const lineItems = invoice_json.line_items || [];
    let sumLines = 0;

    lineItems.forEach((item, idx) => {
      const qty = toNum(item.quantity);
      const unitPrice = toNum(item.unit_price);
      const amount = toNum(item.amount);
      const lineNo = idx + 1;

      if (qty != null && unitPrice != null && amount != null) {
        const expected = Math.round(qty * unitPrice * 100) / 100;
        const diff = Math.abs(expected - amount);
        if (diff > 0.02) {
          flags.push({
            type: 'ARITHMETIC_LINE',
            severity: 'HIGH',
            message: `Line ${lineNo}: qty(${qty}) × unit_price(${unitPrice}) = ${expected} but amount is ${amount} (diff ${diff.toFixed(2)})`,
            line_no: lineNo,
          });
        }
        sumLines += amount;
      } else if (amount != null) {
        sumLines += amount;
      }
    });

    sumLines = Math.round(sumLines * 100) / 100;

    const subtotal = toNum(invoice_json.subtotal);
    const taxAmount = toNum(invoice_json.tax_amount);
    const totalAmount = toNum(invoice_json.total_amount);

    if (subtotal != null) {
      const subtotalDiff = Math.abs(subtotal - sumLines);
      if (subtotalDiff > 0.05) {
        flags.push({
          type: 'ARITHMETIC_SUBTOTAL',
          severity: 'HIGH',
          message: `Subtotal ${subtotal} does not match sum of line items ${sumLines} (diff ${subtotalDiff.toFixed(2)})`,
        });
      }
    }

    const computedSubtotal = subtotal ?? sumLines;
    const computedTotal = Math.round((computedSubtotal + (taxAmount ?? 0)) * 100) / 100;

    if (totalAmount != null) {
      const totalDiff = Math.abs(totalAmount - computedTotal);
      if (totalDiff > 0.05) {
        flags.push({
          type: 'ARITHMETIC_TOTAL',
          severity: 'HIGH',
          message: `Total ${totalAmount} does not match subtotal(${computedSubtotal}) + tax(${taxAmount ?? 0}) = ${computedTotal} (diff ${totalDiff.toFixed(2)})`,
        });
      }
    }

    // ── 2. Duplicate Check ──────────────────────────────────────────────────────
    const vendor = (invoice_json.vendor_name || '').trim().toLowerCase();
    const invNum = (invoice_json.invoice_number || '').trim().toLowerCase();

    if (vendor && invNum && history_index.length > 0) {
      const dup = history_index.find(
        (h) =>
          (h.vendor_name || '').trim().toLowerCase() === vendor &&
          (h.invoice_number || '').trim().toLowerCase() === invNum
      );
      if (dup) {
        flags.push({
          type: 'DUPLICATE_INVOICE',
          severity: 'HIGH',
          message: `Duplicate invoice: vendor "${invoice_json.vendor_name}" + invoice# "${invoice_json.invoice_number}" already exists in history (date: ${dup.invoice_date}, total: ${dup.total})`,
        });
      }
    }

    // ── 3. Contract Price Overages ──────────────────────────────────────────────
    if (contract_prices.length > 0) {
      lineItems.forEach((item, idx) => {
        const sku = (item.sku || item.description || '').trim().toLowerCase();
        const unitPrice = toNum(item.unit_price);
        const lineNo = idx + 1;

        const contract = contract_prices.find(
          (cp) =>
            (cp.vendor_name || '').trim().toLowerCase() === vendor &&
            (cp.sku || '').trim().toLowerCase() === sku
        );

        if (contract && unitPrice != null) {
          const contractPrice = toNum(contract.contract_unit_price);
          if (contractPrice != null && unitPrice > contractPrice + 0.01) {
            const overagePct = (((unitPrice - contractPrice) / contractPrice) * 100).toFixed(1);
            flags.push({
              type: 'CONTRACT_OVERAGE',
              severity: 'MEDIUM',
              message: `Line ${lineNo}: unit_price ${unitPrice} exceeds contract price ${contractPrice} by ${overagePct}% for SKU "${item.sku || item.description}"`,
              line_no: lineNo,
            });
          }
        }
      });
    }

    // ── 4. Unusual Charges ──────────────────────────────────────────────────────
    lineItems.forEach((item, idx) => {
      const desc = (item.description || '').toLowerCase();
      const lineNo = idx + 1;
      const matched = UNUSUAL_KEYWORDS.find((kw) => desc.includes(kw));
      if (matched) {
        flags.push({
          type: 'UNUSUAL_CHARGE',
          severity: 'LOW',
          message: `Line ${lineNo}: description "${item.description}" contains unusual keyword "${matched}"`,
          line_no: lineNo,
        });
      }
    });

    // ── 5. Build Report ─────────────────────────────────────────────────────────
    const status = flags.length === 0 ? 'PASS' : 'FLAG';

    const highFlags = flags.filter((f) => f.severity === 'HIGH').length;
    const medFlags = flags.filter((f) => f.severity === 'MEDIUM').length;

    let recommended_action = 'No issues found. Approve for payment.';
    if (highFlags > 0) {
      recommended_action = `Hold payment. ${highFlags} critical issue${highFlags > 1 ? 's' : ''} require${highFlags === 1 ? 's' : ''} resolution before processing.`;
    } else if (medFlags > 0) {
      recommended_action = `Review ${medFlags} contract pricing discrepanc${medFlags > 1 ? 'ies' : 'y'} with vendor before approving.`;
    } else if (flags.length > 0) {
      recommended_action = 'Minor flags noted. Review unusual charges and approve if acceptable.';
    }

    return Response.json({
      status,
      flags,
      computed: {
        sum_lines: sumLines,
        computed_subtotal: computedSubtotal,
        computed_total: computedTotal,
      },
      recommended_action,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});