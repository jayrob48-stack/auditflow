import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const DEFAULT_VENDOR = "AMERICAN METALS SUPPLY CO INC";

export default function ContractPrices() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ vendor_name: DEFAULT_VENDOR, product_name: "", sku: "", contract_price: "", unit_type: "" });
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);

  const { data: prices = [], isLoading } = useQuery({
    queryKey: ["contract-prices"],
    queryFn: () => base44.entities.ContractPrice.list("product_name", 500),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ContractPrice.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["contract-prices"] }); setOpen(false); toast.success("Contract price added"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ContractPrice.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["contract-prices"] }); toast.success("Deleted"); },
  });

  const handleSave = () => {
    const price = parseFloat(form.contract_price);
    if (!form.product_name || isNaN(price)) { toast.error("Product name and price are required"); return; }
    createMutation.mutate({ ...form, contract_price: price });
  };

  const handleCSVImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const lines = text.trim().split("\n");
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
      const rows = lines.slice(1).map(line => {
        const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i]; });
        return obj;
      });

      let count = 0;
      for (const row of rows) {
        const name = row.product_name || row.description || row.item;
        const price = parseFloat(row.contract_price || row.price || row.unit_price);
        if (!name || isNaN(price)) continue;
        await base44.entities.ContractPrice.create({
          vendor_name: DEFAULT_VENDOR,
          product_name: name,
          sku: row.sku || row.item_number || "",
          contract_price: price,
          unit_type: row.unit_type || row.uom || "",
        });
        count++;
      }
      queryClient.invalidateQueries({ queryKey: ["contract-prices"] });
      toast.success(`Imported ${count} contract prices`);
      setImportFile(null);
    } catch (e) {
      toast.error("Import failed: " + e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contract Prices</h1>
            <p className="text-sm text-slate-400 mt-1">Manage vendor contract pricing catalog</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <label className="cursor-pointer">
              <input type="file" accept=".csv" className="hidden" onChange={e => setImportFile(e.target.files[0])} />
              <Button variant="outline" size="sm" className="gap-1.5 pointer-events-none" asChild>
                <span><Upload className="h-4 w-4" /> Select CSV</span>
              </Button>
            </label>
            {importFile && (
              <Button size="sm" onClick={handleCSVImport} disabled={importing} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                {importing ? "Importing…" : `Import "${importFile.name}"`}
              </Button>
            )}
            <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5 bg-slate-800 hover:bg-slate-900 text-white">
              <Plus className="h-4 w-4" /> Add Price
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">SKU</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Contract Price</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">UOM</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-slate-400 text-sm animate-pulse">Loading…</TableCell></TableRow>
              )}
              {!isLoading && prices.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-slate-400 text-sm">No contract prices. Add or import from CSV.</TableCell></TableRow>
              )}
              {prices.map(p => (
                <TableRow key={p.id} className="group hover:bg-slate-50/50 transition-colors">
                  <TableCell className="font-medium text-slate-700 text-sm">{p.product_name}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{p.sku || "—"}</TableCell>
                  <TableCell className="text-xs text-slate-500 max-w-[160px] truncate">{p.vendor_name}</TableCell>
                  <TableCell className="text-right font-mono font-semibold text-slate-800">${p.contract_price?.toFixed(4)}</TableCell>
                  <TableCell className="text-xs text-slate-500">{p.unit_type || "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500"
                      onClick={() => deleteMutation.mutate(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Contract Price</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div><Label>Vendor</Label><Input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} /></div>
              <div><Label>Product Name *</Label><Input placeholder="e.g. 12/2 NM-B WIRE" value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} /></div>
              <div><Label>SKU (optional)</Label><Input placeholder="e.g. WH12/2G250" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} /></div>
              <div><Label>Contract Price *</Label><Input type="number" step="0.0001" placeholder="0.0000" value={form.contract_price} onChange={e => setForm(f => ({ ...f, contract_price: e.target.value }))} /></div>
              <div><Label>Unit Type</Label><Input placeholder="EA, RL, FT…" value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending} className="bg-slate-800 hover:bg-slate-900 text-white">Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}