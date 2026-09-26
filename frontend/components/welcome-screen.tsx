'use client';

import { UploadDropzone } from '@/components/upload-dropzone';

interface WelcomeScreenProps {
  onUploadSuccess: (data: {
    file_name: string;
    chunks_created: number;
    pages_processed: number;
  }) => void;
}

const sampleQuestions = [
  'Summarize the key financial highlights',
  'What are the main risks mentioned?',
  'Break down revenue by segment',
  'Compare assets vs liabilities',
];

export function WelcomeScreen({ onUploadSuccess }: WelcomeScreenProps) {
  return (
    <div className="flex items-center justify-center h-full px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-xl font-semibold tracking-tight">
            Upload a financial report to begin
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            PDF will be chunked, embedded, and indexed locally
          </p>
        </div>

        {/* Dropzone */}
        <UploadDropzone onUploadSuccess={onUploadSuccess} />

        {/* Sample questions preview */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-3">
            Once uploaded, you can ask:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {sampleQuestions.map((q) => (
              <span
                key={q}
                className="text-xs px-3 py-1.5 rounded-full bg-muted text-muted-foreground"
              >
                {q}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}