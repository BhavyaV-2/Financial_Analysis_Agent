'use client';

import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
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

interface IngestionProgress {
  stage: 'idle' | 'parsing' | 'chunking' | 'embedding' | 'indexing' | 'complete' | 'error';
  percent: number;
  message: string;
  detail?: string;
  fileName?: string;
  fileSize?: string;
}

const STAGES = [
  { key: 'parsing', label: '1. Scan & Read' },
  { key: 'chunking', label: '2. Chunk Text' },
  { key: 'embedding', label: '3. Generate Vectors' },
  { key: 'indexing', label: '4. Save to ChromaDB' },
];

export function UploadDropzone({ onUploadSuccess }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<IngestionProgress>({
    stage: 'idle',
    percent: 0,
    message: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getStageStatus = (stageKey: string) => {
    const stageOrder = ['parsing', 'chunking', 'embedding', 'indexing', 'complete'];
    const currentIndex = stageOrder.indexOf(progress.stage);
    const targetIndex = stageOrder.indexOf(stageKey);

    if (progress.stage === 'error') return 'error';
    if (progress.stage === 'complete' || currentIndex > targetIndex) return 'completed';
    if (progress.stage === stageKey) return 'active';
    return 'pending';
  };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files are accepted.');
      return;
    }

    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);

    setIsProcessing(true);
    setProgress({
      stage: 'parsing',
      percent: 5,
      message: 'Sending document to local pipeline...',
      detail: `File size: ${sizeInMB} MB`,
      fileName: file.name,
      fileSize: `${sizeInMB} MB`,
    });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/upload/`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || 'Upload failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(line.slice(6));

            if (event.stage === 'error') {
              setProgress((prev) => ({
                ...prev,
                stage: 'error',
                message: event.message || 'An error occurred during ingestion.',
              }));
              toast.error(event.message || 'Failed to process document.');
              setIsProcessing(false);
              return;
            }

            setProgress((prev) => ({
              ...prev,
              stage: event.stage,
              percent: Math.min(100, Math.max(prev.percent, event.percent || 0)),
              message: event.message || prev.message,
              detail: event.detail || prev.detail,
            }));

            if (event.stage === 'complete' && event.data) {
              toast.success(`"${file.name}" indexed successfully!`);
              setTimeout(() => {
                onUploadSuccess(event.data);
              }, 600);
            }
          } catch {}
        }
      }
    } catch (error: any) {
      setProgress((prev) => ({
        ...prev,
        stage: 'error',
        message: error.message || 'Failed to connect to the server.',
      }));
      toast.error(error.message || 'Failed to process document.');
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
      onDragOver={!isProcessing ? onDragOver : undefined}
      onDragLeave={!isProcessing ? onDragLeave : undefined}
      onDrop={!isProcessing ? onDrop : undefined}
      onClick={() => !isProcessing && fileInputRef.current?.click()}
      className={cn(
        'border-2 border-dashed rounded-xl p-8 transition-all duration-200 text-left',
        !isProcessing && 'cursor-pointer',
        isDragging
          ? 'border-foreground/50 bg-accent/60 scale-[1.01]'
          : 'border-border hover:border-foreground/30 hover:bg-accent/30',
        isProcessing && 'bg-card border-border shadow-sm'
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
        <div className="space-y-5">
          {/* File Header */}
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2.5 truncate mr-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-foreground/80" />
              </div>
              <div className="truncate">
                <p className="text-xs font-semibold truncate text-foreground">
                  {progress.fileName}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {progress.fileSize}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-lg font-mono font-bold tracking-tight">
                {progress.percent}%
              </span>
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div className="space-y-1.5">
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-300 ease-out rounded-full',
                  progress.stage === 'error'
                    ? 'bg-destructive'
                    : 'bg-foreground'
                )}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
              <span className="font-medium text-foreground truncate mr-2">
                {progress.message}
              </span>
              {progress.detail && (
                <span className="shrink-0 opacity-75 font-mono">
                  {progress.detail}
                </span>
              )}
            </div>
          </div>

          {/* Stepper Breakdown */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {STAGES.map((step) => {
              const status = getStageStatus(step.key);
              return (
                <div
                  key={step.key}
                  className={cn(
                    'p-2 rounded-md border text-center transition-colors text-[10px] font-medium',
                    status === 'active' && 'border-foreground/40 bg-accent text-foreground font-semibold',
                    status === 'completed' && 'border-border/60 bg-muted/40 text-muted-foreground',
                    status === 'pending' && 'border-border/40 opacity-40 text-muted-foreground',
                    status === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive'
                  )}
                >
                  <div className="flex items-center justify-center gap-1">
                    {status === 'active' && (
                      <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                    )}
                    {status === 'completed' && (
                      <CheckCircle2 className="h-2.5 w-2.5 text-foreground/70 shrink-0" />
                    )}
                    <span className="truncate">{step.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {progress.stage === 'error' && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsProcessing(false);
                  setProgress({ stage: 'idle', percent: 0, message: '' });
                }}
                className="text-xs text-destructive hover:underline font-medium inline-flex items-center gap-1"
              >
                <AlertCircle className="h-3 w-3" />
                Reset and try another file
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-4">
          <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">
            Drag & drop a PDF here
          </p>
          <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
          <p className="text-xs text-muted-foreground mt-3 opacity-70">
            Handles large reports (400+ pages) with live progress tracking
          </p>
        </div>
      )}
    </div>
  );
}
