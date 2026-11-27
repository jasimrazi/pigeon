import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Search, ArrowRight, X } from 'lucide-react';

export interface CommandPaletteAction {
  id: string;
  label: string;
  group: 'Navigation' | 'Actions' | 'Appearance';
  keywords?: string;
  shortcut?: string;
  onSelect: () => void | Promise<void>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
}

export function CommandPalette({ isOpen, onClose, actions }: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.group.toLowerCase().includes(q) ||
        (a.keywords && a.keywords.toLowerCase().includes(q)),
    );
  }, [actions, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = filtered[selectedIndex];
        if (chosen) {
          onClose();
          void chosen.onSelect();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, filtered, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-[8px] shadow-xl max-w-lg w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border">
          <Search size={15} className="text-fg-muted shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Search commands"
            placeholder="Jump to a view, setting, or system action..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="text-fg-muted hover:text-fg p-1 rounded-[4px] cursor-pointer"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[340px] overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-fg-muted">
              No matching commands found.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onClose();
                    void item.onSelect();
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-left text-[13px] transition-colors cursor-pointer ${
                    active ? 'bg-surface-subtle text-fg font-medium' : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-[4px] border border-border bg-surface text-fg-muted shrink-0">
                      {item.group}
                    </span>
                    <span className="truncate text-fg">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.shortcut && (
                      <kbd className="text-[11px] font-mono px-1.5 py-0.5 rounded-[4px] border border-border bg-surface text-fg-muted">
                        {item.shortcut}
                      </kbd>
                    )}
                    <ArrowRight size={13} className="text-fg-muted" aria-hidden="true" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-3.5 py-2 border-t border-border bg-surface-subtle flex items-center justify-between text-[11px] text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <Command size={11} aria-hidden="true" />
            <span>Up/Down to navigate, Enter to run</span>
          </span>
          <span className="font-mono">Esc to close</span>
        </div>
      </div>
    </div>
  );
}
