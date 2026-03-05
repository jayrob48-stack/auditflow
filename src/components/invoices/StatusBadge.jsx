import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertTriangle, Eye } from "lucide-react";

const statusConfig = {
  processing: { label: "Processing", icon: Loader2, className: "bg-slate-100 text-slate-600 border-slate-200", spin: true },
  extracted: { label: "Extracted", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  reviewed: { label: "Reviewed", icon: Eye, className: "bg-blue-50 text-blue-700 border-blue-200" },
  flagged: { label: "Flagged", icon: AlertTriangle, className: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.processing;
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn("gap-1.5 px-2.5 py-1 font-medium text-xs", config.className)}>
      <Icon className={cn("h-3 w-3", config.spin && "animate-spin")} />
      {config.label}
    </Badge>
  );
}