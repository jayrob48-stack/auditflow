/**
 * processAmericanMetalsInvoice
 *
 * Full pipeline:
 *   1. Receive file_url (uploaded PDF)
 *   2. Extract text via LLM vision
 *   3. Normalise line items
 *   4. Load contract prices from ContractPrice entity
 *   5. Arithmetic + math + total audit
 *   6. Contract price audit (exact → normalised → fuzzy 90%)
 *   7. Duplicate detection
 *   8. Persist Invoice + AuditRun
 *   9. Return structured audit report
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// ── helpers ──────────────────────────────────────────────────────────────────

function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 10000) / 10000;
}

/**
 * Normalise "126.090RL" → { price: 126.09, unit: "RL" }
 * Also handles plain numbers.
 */
function parseAmericanMetalsPrice(raw) {
  if (raw == null) return { price: null, unit: null };
  const s = String(raw).trim();
  const match = s.match(/^([0-9,]+(?:\.[0-9]+)?)([A-Z]+)?$/i);
  if (!match) return { price: toNum(s), unit: null };
  return {
    price: toNum(match[1].replace(/,/g, '')),
    unit: match[2] ? match[2].toUpperCase() : null,
  };
}

/** Normalise a description for matching */
function normDesc(s) {
  // Strip bracket/paren suffixes like [212] (ATD) and lowercase
  return String(s || '').toLowerCase().replace(/[\[\(][^\]\)]*[\]\)]/g, '').replace(/\s+/g, ' ').trim();
}

/** Strip all non-alpha characters and split into word tokens */
function tokenSet(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

/** Simple Dice-coefficient similarity (no external deps) */
function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  const bigrams = (str) => {
    const bg = new Set();
    for (let i = 0; i < str.length - 1; i++) bg.add(str.slice(i, i + 2));
    return bg;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const bg of A) if (B.has(bg)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Find best contract price match for a description.
 * Returns { contract, method } or null.
 *
 * Match order:
 *   1) Exact string
 *   2) Normalised exact (after stripping brackets/parens)
 *   3) Token-subset: all tokens of the shorter name appear in the longer
 *   4) Fuzzy Dice ≥ 80%
 */
function findContract(desc, contracts) {
  const nd = normDesc(desc);
  const descTokens = tokenSet(desc);

  // 1) Exact
  let hit = contracts.find(c => c.product_name === desc);
  if (hit) return { contract: hit, method: 'exact' };

  // 2) Normalised exact
  hit = contracts.find(c => normDesc(c.product_name) === nd);
  if (hit) return { contract: hit, method: 'normalised' };

  // 3) Token-subset match
  for (const c of contracts) {
    const contractTokens = tokenSet(c.product_name);
    const smaller = contractTokens.size <= descTokens.size ? contractTokens : descTokens;
    const larger  = contractTokens.size <= descTokens.size ? descTokens : contractTokens;
    if (smaller.size >= 2 && [...smaller].every(t => larger.has(t))) {
      return { contract: c, method: 'token-subset' };
    }
  }

  // 4) Fuzzy Dice ≥ 80%
  let best = null;
  let bestScore = 0;
  for (const c of contracts) {
    const score = diceSimilarity(nd, normDesc(c.product_name));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (bestScore >= 0.8) return { contract: best, method: `fuzzy(${(bestScore * 100).toFixed(1)}%)` };
  return null;
}

const UNUSUAL_KW = ['fee', 'surcharge', 'fuel', 'service', 'freight', 'handling', 'misc'];

// ── main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { file_url, vendor_name = 'AMERICAN METALS SUPPLY CO INC' } = body;
    if (!file_url) return Response.json({ error: 'file_url required' }, { status: 400 });

    // ── STEP 2: Extract structured data via LLM vision ────────────────────────
    const EXTRACTION_SCHEMA = {
      type: 'object',
      properties: {
        vendor_name: { type: 'string' },
        invoice_number: { type: 'string' },
        invoice_date: { type: 'string' },
        customer_name: { type: 'string' },
        customer_address: { type: 'string' },
        subtotal: { type: 'number' },
        tax_amount: { type: 'number' },
        shipping: { type: 'number' },
        total_amount: { type: 'number' },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              order_qty: { type: 'number' },
              ship_qty: { type: 'number' },
              unit_price_raw: { type: 'string' },
              extended_price_raw: { type: 'string' },
              unit_type: { type: 'string' },
            },
          },
        },
      },
    };

    const extracted = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an invoice audit engine processing an invoice from "${vendor_name}".
Extract ALL fields exactly as they appear. For unit_price_raw and extended_price_raw keep the original string including any trailing unit letters (e.g. "126.090RL"). Do not convert prices yourself.
Normalize dates to YYYY-MM-DD. Return null for missing fields.
Vendor address is: 1920 Marketplace Ave, Kyle TX`,
      file_urls: [file_url],
      response_json_schema: EXTRACTION_SCHEMA,
    });

    // ── STEP 3: Normalise line items ──────────────────────────────────────────
    const rawItems = extracted.line_items || [];
    const lineItems = rawItems.map((item, idx) => {
      const { price: unitPrice, unit: unitFromPrice } = parseAmericanMetalsPrice(item.unit_price_raw);
      const { price: extPrice } = parseAmericanMetalsPrice(item.extended_price_raw);
      const unitType = item.unit_type || unitFromPrice || null;
      const desc = String(item.description || '').replace(/\s+/g, ' ').trim();
      const qty = toNum(item.ship_qty ?? item.order_qty);
      return {
        line_no: idx + 1,
        description: desc,
        order_qty: toNum(item.order_qty),
        ship_qty: qty,
        unit_price: unitPrice,
        extended_price: extPrice,
        unit_type: unitType,
      };
    });

    // ── STEP 4: Load contract prices ──────────────────────────────────────────
    const allContracts = await base44.asServiceRole.entities.ContractPrice.filter(
      { vendor_name }
    );

    const flags = [];

    // ── STEP 5 + 6: Per-line audit (contract + arithmetic) ────────────────────
    let totalOvercharge = 0;
    const affectedLines = new Set();

    for (const item of lineItems) {
      const { line_no, description, ship_qty, unit_price, extended_price } = item;

      // Math audit (qty × unit_price ≈ extended_price)
      if (ship_qty != null && unit_price != null && extended_price != null) {
        const expected = Math.round(ship_qty * unit_price * 100) / 100;
        const diff = Math.abs(expected - extended_price);
        if (diff > 0.02) {
          flags.push({
            type: 'ARITHMETIC',
            severity: 'HIGH',
            message: `Line ${line_no}: ${ship_qty} × ${unit_price} = ${expected} but extended_price is ${extended_price} (Δ${diff.toFixed(2)})`,
            line_no,
          });
          affectedLines.add(line_no);
        }
      }

      // Contract price audit
      const match = findContract(description, allContracts);
      if (match && unit_price != null) {
        const contractPrice = match.contract.contract_price;
        if (unit_price > contractPrice + 0.01) {
          const diff = Math.round((unit_price - contractPrice) * 100) / 100;
          const pct = ((diff / contractPrice) * 100).toFixed(2);
          const overchargeDollars = ship_qty != null ? Math.round(diff * ship_qty * 100) / 100 : diff;
          totalOvercharge += overchargeDollars;
          affectedLines.add(line_no);
          flags.push({
            type: 'OVERCHARGE',
            severity: 'HIGH',
            invoice_number: extracted.invoice_number,
            item_description: description,
            contract_price: contractPrice,
            invoice_price: unit_price,
            difference: diff,
            percent_over: parseFloat(pct),
            match_method: match.method,
            line_no,
            message: `Line ${line_no}: "${description}" — invoice $${unit_price} vs contract $${contractPrice} (+${pct}%, Δ$${overchargeDollars.toFixed(2)}) [${match.method}]`,
          });
        }
      }

      // Unusual charge keywords
      const descLow = description.toLowerCase();
      const hit = UNUSUAL_KW.find(kw => descLow.includes(kw));
      if (hit) {
        flags.push({
          type: 'UNUSUAL_CHARGE',
          severity: 'LOW',
          message: `Line ${line_no}: "${description}" contains unusual keyword "${hit}"`,
          line_no,
        });
        affectedLines.add(line_no);
      }
    }

    // ── STEP 7: Invoice total check ───────────────────────────────────────────
    const sumLines = Math.round(lineItems.reduce((s, i) => s + (i.extended_price ?? 0), 0) * 100) / 100;
    const subtotal = toNum(extracted.subtotal);
    const tax = toNum(extracted.tax_amount) ?? 0;
    const shipping = toNum(extracted.shipping) ?? 0;
    const invoiceTotal = toNum(extracted.total_amount);

    if (subtotal != null && Math.abs(subtotal - sumLines) > 0.05) {
      flags.push({
        type: 'SUBTOTAL_MISMATCH',
        severity: 'HIGH',
        message: `Subtotal ${subtotal} ≠ sum of line extended prices ${sumLines} (Δ${Math.abs(subtotal - sumLines).toFixed(2)})`,
      });
    }

    const computedSubtotal = subtotal ?? sumLines;
    const computedTotal = Math.round((computedSubtotal + tax + shipping) * 100) / 100;
    if (invoiceTotal != null && Math.abs(invoiceTotal - computedTotal) > 0.05) {
      flags.push({
        type: 'TOTAL_MISMATCH',
        severity: 'HIGH',
        message: `Invoice total ${invoiceTotal} ≠ subtotal(${computedSubtotal}) + tax(${tax}) + shipping(${shipping}) = ${computedTotal} (Δ${Math.abs(invoiceTotal - computedTotal).toFixed(2)})`,
      });
    }

    // ── STEP 8: Duplicate detection ───────────────────────────────────────────
    const existing = await base44.asServiceRole.entities.Invoice.filter({
      vendor_name,
      invoice_number: extracted.invoice_number,
    });
    if (existing.length > 0) {
      flags.push({
        type: 'DUPLICATE',
        severity: 'HIGH',
        message: `Invoice #${extracted.invoice_number} from ${vendor_name} already exists (id: ${existing[0].id})`,
      });
    }

    totalOvercharge = Math.round(totalOvercharge * 100) / 100;
    const status = flags.length === 0 ? 'PASS' : 'FLAG';

    // ── STEP 9: Persist results ───────────────────────────────────────────────
    let savedInvoice;
    if (existing.length === 0) {
      savedInvoice = await base44.asServiceRole.entities.Invoice.create({
        vendor_name: extracted.vendor_name || vendor_name,
        invoice_number: extracted.invoice_number,
        invoice_date: extracted.invoice_date,
        bill_to: extracted.customer_name,
        bill_to_address: extracted.customer_address,
        subtotal: subtotal,
        tax_amount: tax || null,
        shipping: shipping || null,
        total_amount: invoiceTotal,
        line_items: lineItems,
        needs_review: status === 'FLAG',
        review_notes: flags.map(f => f.message).join('\n'),
        status: status === 'PASS' ? 'extracted' : 'flagged',
        file_url,
        raw_json: JSON.stringify(extracted),
      });
    }

    const auditReport = {
      invoice_number: extracted.invoice_number,
      invoice_date: extracted.invoice_date,
      vendor: vendor_name,
      status,
      flags,
      total_overcharge: totalOvercharge,
      items_affected: affectedLines.size,
      computed: { sum_lines: sumLines, computed_subtotal: computedSubtotal, computed_total: computedTotal },
      line_items: lineItems,
    };

    const auditRun = await base44.asServiceRole.entities.AuditRun.create({
      invoice_id: savedInvoice?.id || existing[0]?.id || null,
      invoice_number: extracted.invoice_number,
      invoice_date: extracted.invoice_date,
      vendor: vendor_name,
      status,
      flags,
      total_overcharge: totalOvercharge,
      items_affected: affectedLines.size,
      computed_subtotal: computedSubtotal,
      computed_total: computedTotal,
      sum_lines: sumLines,
      audit_json: JSON.stringify(auditReport, null, 2),
      alert_sent: false,
    });

    // ── STEP 10: Send alerts if flagged ───────────────────────────────────────
    if (status === 'FLAG') {
      const overchargeFlags = flags.filter(f => f.type === 'OVERCHARGE');
      const summary = [
        `🚨 Invoice Audit Alert`,
        `Invoice #: ${extracted.invoice_number}`,
        `Date: ${extracted.invoice_date}`,
        `Vendor: ${vendor_name}`,
        `Status: ${status}`,
        `Total Overcharge: $${totalOvercharge.toFixed(2)}`,
        `Items Affected: ${affectedLines.size}`,
        `Flags (${flags.length}):`,
        ...flags.map(f => `  [${f.severity}] ${f.type}: ${f.message}`),
      ].join('\n');

      // Email alert
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          subject: `⚠️ Invoice Audit FLAG — ${vendor_name} #${extracted.invoice_number}`,
          body: `<pre style="font-family:monospace;font-size:13px">${summary}</pre>`,
        });
      } catch (e) {
        console.error('Email alert failed:', e.message);
      }

      // Mark alert sent
      await base44.asServiceRole.entities.AuditRun.update(auditRun.id, {
        alert_sent: true,
        alert_channels: ['email'],
      });
    }

    return Response.json({ success: true, audit_run_id: auditRun.id, report: auditReport });
  } catch (error) {
    console.error('processAmericanMetalsInvoice error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});