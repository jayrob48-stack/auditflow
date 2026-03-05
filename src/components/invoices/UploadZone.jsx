import { useState, useRef } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function UploadZone({ onUpload, isUploading }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = (files) => {
    const pdfs = Array.from(files).filter(f =>
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length > 0) onUpload(pdfs);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        "relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer",
        dragOver
          ? "border-blue-400 bg-blue-50/50 scale-[1.01]"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50",
        isUploading && "pointer-events-none opacity-60"
      )}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex flex-col items-center gap-4">
        {isUploading ? (
          <>
            <div className="p-4 rounded-2xl bg-blue-50">
              <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">Extracting invoice data…</p>
              <p className="text-xs text-slate-400 mt-1">This may take a few seconds per invoice</p>
            </div>
          </>
        ) : (
          <>
            <div className="p-4 rounded-2xl bg-slate-100">
              <Upload className="h-8 w-8 text-slate-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">
                Drop invoice PDFs here or <span className="text-blue-600">browse</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">PDF files only — data is extracted automatically</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}