'use client';

import { useState, useRef } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const API_BASE = 'http://127.0.0.1:8000';

interface UploadDropzoneProps {
  onUploadSuccess: (data: {
    file_name: string;
    chunks_created: number;
    pages_processed: number;
  }) => void;
}

export function UploadDropzone({ onUploadSuccess }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files are accepted.');
      return;
    }

    setIsProcessing(true);
    setProgress('Uploading and processing...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/upload/`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || 'Upload failed');
      }

      const data = await res.json();
      setProgress(
        `Done — ${data.chunks_created} chunks from ${data.pages_processed} pages`
      );
      toast.success(`"${file.name}" processed successfully.`);
      onUploadSuccess(data);
    } catch (error: any) {
      toast.error(error.message || 'Failed to process document.');
      setProgress('');
    } finally {
      setIsProcessing(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => !isProcessing && fileInputRef.current?.click()}
      className={cn(
        'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200',
        isDragging
          ? 'border-foreground/40 bg-accent/50 scale-[1.01]'
          : 'border-border hover:border-foreground/25 hover:bg-accent/30',
        isProcessing && 'pointer-events-none opacity-60'
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={onChange}
      />

      {isProcessing ? (
        <div>
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{progress}</p>
        </div>
      ) : (
        <div>
          <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">
            Drag & drop a PDF here
          </p>
          <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
          <p className="text-xs text-muted-foreground mt-3 opacity-70">
            Annual reports · 10-K · 10-Q · Earnings transcripts
          </p>
        </div>
      )}
    </div>
  );
}
