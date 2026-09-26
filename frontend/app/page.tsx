'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import TextareaAutosize from 'react-textarea-autosize';
import { ThemeToggle } from '@/components/theme-toggle';
import { ChatMessage } from '@/components/chat-message';
import { WelcomeScreen } from '@/components/welcome-screen';
import { DocumentManager } from '@/components/document-manager';
import { UploadDropzone } from '@/components/upload-dropzone';

const API_BASE = 'http://127.0.0.1:8000';

interface Message {
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

const examplePrompts = [
  'Summarize the key financial highlights of the report.',
  'What are the main risks mentioned?',
  'Provide a revenue and net income overview.',
  'Compare total assets to total liabilities.',
];

export default function Home() {
  const [activeDoc, setActiveDoc] = useState<{
    filename: string;
    chunks: number;
  } | null>(null);
  const [documents, setDocuments] = useState<
    Array<{ filename: string; chunks: number }>
  >([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Load chat from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('fintrack_chat');
    const savedDoc = localStorage.getItem('fintrack_active_doc');
    if (saved) {
      try {
        setMessages(
          JSON.parse(saved).map((m: Message) => ({ ...m, isStreaming: false }))
        );
      } catch {}
    }
    if (savedDoc) {
      try {
        setActiveDoc(JSON.parse(savedDoc));
      } catch {}
    }
  }, []);

  // Persist chat to localStorage
  useEffect(() => {
    if (messages.length > 0 && !messages.some((m) => m.isStreaming)) {
      localStorage.setItem(
        'fintrack_chat',
        JSON.stringify(messages.map(({ isStreaming, ...rest }) => rest))
      );
    }
  }, [messages]);

  // Persist active doc
  useEffect(() => {
    if (activeDoc) {
      localStorage.setItem('fintrack_active_doc', JSON.stringify(activeDoc));
    }
  }, [activeDoc]);

  // Fetch documents from backend
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/documents/`);
      if (res.ok) {
        const docs = await res.json();
        setDocuments(docs);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleUploadSuccess = (data: {
    file_name: string;
    chunks_created: number;
    pages_processed: number;
  }) => {
    const docInfo = { filename: data.file_name, chunks: data.chunks_created };
    setActiveDoc(docInfo);
    setMessages([]);
    setShowUpload(false);
    localStorage.removeItem('fintrack_chat');
    fetchDocuments();
  };

  const handleDeleteDocument = async (filename: string) => {
    try {
      const res = await fetch(
        `${API_BASE}/documents/${encodeURIComponent(filename)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        toast.success(`Deleted "${filename}"`);
        if (activeDoc?.filename === filename) {
          setActiveDoc(null);
          setMessages([]);
          localStorage.removeItem('fintrack_chat');
          localStorage.removeItem('fintrack_active_doc');
        }
        fetchDocuments();
      }
    } catch {
      toast.error('Failed to delete document.');
    }
  };

  const sendMessage = async (message: string) => {
    if (!message.trim() || isStreaming) return;
    setInputValue('');
    setIsStreaming(true);

    const userMsg: Message = { role: 'user', content: message };
    const assistantMsg: Message = {
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    // Build chat history for API (exclude current messages)
    const apiHistory = messages.map((m) => ({
      type: m.role === 'user' ? 'human' : 'assistant',
      content: m.content,
    }));

    try {
      const response = await fetch(`${API_BASE}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: message,
          chat_history: apiHistory,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to get response');
      }

      const reader = response.body.getReader();
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
            const data = JSON.parse(line.slice(6));

            if (data.type === 'chunk') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + data.content,
                  };
                }
                return updated;
              });
            } else if (data.type === 'sources') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    sources: data.content,
                  };
                }
                return updated;
              });
            } else if (data.type === 'error') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: data.content,
                    isStreaming: false,
                  };
                }
                return updated;
              });
            } else if (data.type === 'done') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    isStreaming: false,
                  };
                }
                return updated;
              });
            }
          } catch {}
        }
      }

      // Ensure streaming is cleared
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant' && last.isStreaming) {
          updated[updated.length - 1] = { ...last, isStreaming: false };
        }
        return updated;
      });
    } catch {
      toast.error('Failed to get a response from the assistant.');
      setMessages((prev) => prev.slice(0, -2));
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight">Fintrack</h1>
          {activeDoc && (
            <>
              <span className="text-border">|</span>
              <DocumentManager
                documents={documents}
                activeDoc={activeDoc}
                onDelete={handleDeleteDocument}
                onUploadClick={() => setShowUpload(true)}
              />
            </>
          )}
        </div>
        <ThemeToggle />
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {!activeDoc || showUpload ? (
          <WelcomeScreen onUploadSuccess={handleUploadSuccess} />
        ) : (
          <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
            {/* Chat messages */}
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto px-4 py-6 space-y-5"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground mb-5">
                    Document loaded. Ask a question or try a prompt below.
                  </p>
                  <div className="grid grid-cols-2 gap-2.5 max-w-lg w-full">
                    {examplePrompts.map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        onClick={() => sendMessage(prompt)}
                        className="h-auto whitespace-normal text-left px-4 py-3 text-xs leading-relaxed justify-start"
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <ChatMessage
                    key={i}
                    role={msg.role}
                    content={msg.content}
                    sources={msg.sources}
                    isStreaming={msg.isStreaming}
                  />
                ))
              )}
            </div>

            {/* Input bar */}
            <div className="border-t bg-background px-4 py-3">
              <form
                onSubmit={handleSubmit}
                className="flex items-end gap-2 max-w-3xl mx-auto"
              >
                <TextareaAutosize
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Ask about this document..."
                  className="flex-1 resize-none rounded-xl border bg-muted/30 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                  minRows={1}
                  maxRows={4}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  disabled={isStreaming}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={isStreaming || !inputValue.trim()}
                  className="shrink-0 h-10 w-10 rounded-xl"
                >
                  {isStreaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}