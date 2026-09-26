'use client';

import { FileText, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface DocumentManagerProps {
  documents: Array<{ filename: string; chunks: number }>;
  activeDoc: { filename: string; chunks: number } | null;
  onDelete: (filename: string) => void;
  onUploadClick: () => void;
}

export function DocumentManager({
  documents,
  activeDoc,
  onDelete,
  onUploadClick,
}: DocumentManagerProps) {
  if (!activeDoc) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground h-8">
          <FileText className="h-3.5 w-3.5" />
          <span className="text-xs font-medium max-w-[180px] truncate">
            {activeDoc.filename}
          </span>
          <span className="text-xs opacity-60">
            ({activeDoc.chunks} chunks)
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {documents.map((doc) => (
          <DropdownMenuItem
            key={doc.filename}
            className="flex items-center justify-between"
          >
            <span className="text-xs truncate flex-1">{doc.filename}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 ml-2 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(doc.filename);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={onUploadClick} className="text-xs gap-1.5">
          <Upload className="h-3 w-3" />
          Upload new document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
