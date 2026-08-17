/**
 * T5 — the drop zone: click-to-choose AND drag & drop, both landing on the
 * same .docx validation path.
 *
 * The <input type="file"> stays a PLAIN, always-mounted element (not hidden
 * via display:none — Playwright's setInputFiles works on it, T6 e2e) and is
 * styled as an invisible full-zone overlay so a click anywhere opens the
 * picker while drag & drop events still reach the section handlers below.
 *
 * Validation: only the `.docx` extension is accepted (case-insensitive);
 * anything else shows an inline message and never reaches the worker. The
 * accepted file is read via File.arrayBuffer() — the raw bytes (transferable)
 * go straight to useAnalyze.analyze(bytes.buffer → ArrayBuffer, file.name).
 *
 * M005-S02-T3 (Tailwind v4 — user directive): full visual redesign per
 * UI-SPEC mockup 5.1. testids + logic FROZEN — classes are Tailwind
 * utilities only.
 */

import { useRef, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { DocumentIcon } from './icons';

export interface DropZoneProps {
  /** Called with the raw file bytes + name once a .docx passes validation. */
  onAnalyze: (bytes: ArrayBuffer, fileName: string) => void;
}

export default function DropZone({ onAnalyze }: DropZoneProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // The rejected file NAME is kept (not the formatted message) so a locale
  // switch re-renders the message in the new language.
  const [invalidFileName, setInvalidFileName] = useState<string | null>(null);
  // DragEnter fires on every child boundary — count depth so the highlight
  // only clears once the pointer truly leaves the zone.
  const dragDepth = useRef(0);

  function handleFile(file: File | undefined): void {
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setInvalidFileName(file.name);
      return;
    }
    setInvalidFileName(null);
    // File.arrayBuffer() resolves with an ArrayBuffer — pass the raw bytes
    // (transferable) to the worker client; the UI state machine takes over.
    void file.arrayBuffer().then((buffer) => onAnalyze(buffer, file.name));
  }

  const zoneClasses = [
    'relative',
    'mx-auto',
    'flex',
    'max-w-xl',
    'flex-col',
    'items-center',
    'justify-center',
    'gap-2',
    'rounded-lg',
    'border-2',
    'border-dashed',
    'border-border-strong',
    'bg-surface',
    'px-6',
    'py-16',
    'text-center',
    'shadow-sm',
    'transition-colors',
    'duration-150',
    dragging
      ? 'border-accent bg-accent-tint shadow-md'
      : 'hover:border-accent hover:bg-subtle',
    invalidFileName !== null ? 'border-severity-error' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className={`drop-zone ${zoneClasses}`}
      data-testid="drop-zone"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        handleFile(event.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        data-testid="file-input"
        className="file-input absolute inset-0 z-zone-overlay h-full w-full cursor-pointer opacity-0"
        aria-label={t('drop.choose-label')}
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <DocumentIcon className="pointer-events-none h-8 w-8 text-accent" />
      <p className="pointer-events-none m-0 font-display text-xl font-semibold text-balance text-ink">
        {dragging ? t('drop.dragging') : t('drop.title')}
      </p>
      <p className="pointer-events-none m-0 text-sm text-pretty text-muted">
        {t('drop.hint')}
      </p>
      {invalidFileName !== null && (
        <p className="drop-zone-invalid m-0 rounded-md bg-severity-error-tint px-3 py-2 text-sm text-severity-error" role="alert">
          {t('drop.invalid-file', { name: invalidFileName })}
        </p>
      )}
    </section>
  );
}
