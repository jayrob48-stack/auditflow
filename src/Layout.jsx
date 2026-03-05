import { Toaster } from "sonner";

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="top-right" richColors />
      {children}
    </div>
  );
}