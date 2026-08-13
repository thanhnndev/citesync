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
 */

import { useRef, useState } from 'react';

export interface DropZoneProps {
  /** Called with the raw file bytes + name once a .docx passes validation. */
  onAnalyze: (bytes: ArrayBuffer, fileName: string) => void;
}

export default function DropZone({ onAnalyze }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [invalidFile, setInvalidFile] = useState<string | null>(null);
  // DragEnter fires on every child boundary — count depth so the highlight
  // only clears once the pointer truly leaves the zone.
  const dragDepth = useRef(0);

  function handleFile(file: File | undefined): void {
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setInvalidFile(`"${file.name}" is not a .docx file. Choose a Word document saved as .docx.`);
      return;
    }
    setInvalidFile(null);
    // File.arrayBuffer() resolves with an ArrayBuffer — pass the raw bytes
    // (transferable) to the worker client; the UI state machine takes over.
    void file.arrayBuffer().then((buffer) => onAnalyze(buffer, file.name));
  }

  return (
    <section
      className={`drop-zone${dragging ? ' drop-zone-dragging' : ''}`}
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
        className="file-input"
        aria-label="Choose a .docx file to analyze"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <p className="drop-zone-title">
        {dragging ? 'Drop to analyze' : 'Drop a .docx file here'}
      </p>
      <p className="drop-zone-hint">
        or click to choose — analysis runs locally in your browser
      </p>
      {invalidFile !== null && <p className="drop-zone-invalid">{invalidFile}</p>}
    </section>
  );
}
