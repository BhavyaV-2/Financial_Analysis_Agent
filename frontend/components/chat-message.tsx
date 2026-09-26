'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Bot, User, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { motion } from 'framer-motion';
import { SourceCitation } from './source-citation';

export interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{
    page: number;
    snippet: string;
    score: number;
    source: string;
  }>;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, sources, isStreaming }: ChatMessageProps) {
  const [hasCopied, setHasCopied] = useState(false);
  const isUser = role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={cn('flex items-start gap-3', isUser ? 'justify-end' : '')}
    >
      {!isUser && (
        <div className="shrink-0 h-7 w-7 rounded-full bg-foreground/10 flex items-center justify-center mt-0.5">
          <Bot className="h-4 w-4 text-foreground/70" />
        </div>
      )}

      <div
        className={cn(
          'px-4 py-3 rounded-2xl max-w-2xl relative group',
          isUser
            ? 'bg-foreground text-background rounded-br-md'
            : 'bg-muted/60 rounded-bl-md'
        )}
      >
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        ) : (
          <>
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>

            {/* Streaming indicator */}
            {isStreaming && (
              <span className="inline-flex gap-1 ml-1 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:300ms]" />
              </span>
            )}

            {/* Sources */}
            {!isStreaming && sources && sources.length > 0 && (
              <SourceCitation sources={sources} />
            )}

            {/* Copy button */}
            {!isStreaming && content && (
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCopy}
                >
                  {hasCopied ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {isUser && (
        <div className="shrink-0 h-7 w-7 rounded-full bg-foreground/10 flex items-center justify-center mt-0.5">
          <User className="h-4 w-4 text-foreground/70" />
        </div>
      )}
    </motion.div>
  );
}
