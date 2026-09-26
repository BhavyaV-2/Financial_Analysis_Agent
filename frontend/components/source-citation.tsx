'use client';

import { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Source {
  page: number;
  snippet: string;
  score: number;
  source: string;
}

interface SourceCitationProps {
  sources: Source[];
}

export function SourceCitation({ sources }: SourceCitationProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!sources || sources.length === 0) return null;

  const pageList = sources.map((s) => `p.${s.page}`).join(', ');

  return (
    <div className="mt-3 pt-2 border-t border-border/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileText className="h-3 w-3" />
        <span>Sources: {pageList}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform duration-200',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {sources.map((source, i) => (
            <div
              key={i}
              className="text-xs bg-muted/50 p-2.5 rounded-md border border-border/30"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">Page {source.page}</span>
                <span className="text-muted-foreground">
                  relevance: {source.score}/10
                </span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {source.snippet}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
