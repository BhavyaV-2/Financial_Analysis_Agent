'use client';

import { UploadDropzone } from '@/components/upload-dropzone';

interface PDFUploaderProps {
  onUploadSuccess: (data: {
    file_name: string;
    chunks_created: number;
    pages_processed: number;
  }) => void;
}

export function PDFUploader({ onUploadSuccess }: PDFUploaderProps) {
  return <UploadDropzone onUploadSuccess={onUploadSuccess} />;
}