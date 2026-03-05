import { Toaster } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { FileText, ShieldCheck, BookOpen } from "lucide-react";

const navItems = [
  { label: "Dashboard", page: "Dashboard", icon: FileText },
  { label: "Audit Runs", page: "AuditRuns", icon: ShieldCheck },
  { label: "Contract Prices", page: "ContractPrices", icon: BookOpen },
];

export default function Layout({ children, currentPageName }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="top-right" richColors />
      <nav className="bg-white border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-6 h-14">
          <span className="font-bold text-slate-800 text-sm tracking-tight mr-4">Invoice Audit Engine</span>
          {navItems.map(({ label, page, icon: Icon }) => (
            <Link
              key={page}
              to={createPageUrl(page)}
              className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                currentPageName === page
                  ? "text-blue-600"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}