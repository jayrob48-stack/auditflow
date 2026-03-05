/**
 * exportAuditReport
 * Returns audit_report.json and audit_report.csv for a given audit_run_id.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

function toCSVRow(cells) {
  return cells.map(c => {
    const s = String(c ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }).join(',');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { audit_run_id, format = 'json' } = await req.json();
    if (!audit_run_id) return Response.json({ error: 'audit_run_id required' }, { status: 400 });

    const runs = await base44.entities.AuditRun.filter({ id: audit_run_id });
    if (!runs.length) return Response.json({ error: 'AuditRun not found' }, { status: 404 });
    const run = runs[0];

    const report = run.audit_json ? JSON.parse(run.audit_json) : {
      invoice_number: run.invoice_number,
      invoice_date: run.invoice_date,
      vendor: run.vendor,
      status: run.status,
      flags: run.flags || [],
      total_overcharge: run.total_overcharge,
      items_affected: run.items_affected,
      computed: {
        sum_lines: run.sum_lines,
        computed_subtotal: run.computed_subtotal,
        computed_total: run.computed_total,
      },
      line_items: [],
    };

    if (format === 'csv') {
      const headers = ['invoice_number','invoice_date','vendor','status','flag_type','severity','message','line_no','total_overcharge','items_affected'];
      const rows = [toCSVRow(headers)];

      if (!report.flags || report.flags.length === 0) {
        rows.push(toCSVRow([
          report.invoice_number, report.invoice_date, report.vendor, report.status,
          '', '', 'No flags', '', report.total_overcharge ?? 0, report.items_affected ?? 0,
        ]));
      } else {
        for (const flag of report.flags) {
          rows.push(toCSVRow([
            report.invoice_number, report.invoice_date, report.vendor, report.status,
            flag.type, flag.severity, flag.message, flag.line_no ?? '',
            report.total_overcharge ?? 0, report.items_affected ?? 0,
          ]));
        }
      }

      return new Response(rows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="audit_report_${run.invoice_number || run.id}.csv"`,
        },
      });
    }

    // default: json
    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="audit_report_${run.invoice_number || run.id}.json"`,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});