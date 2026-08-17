/**
 * T5 — the scrollable source document view with click-to-source highlight
 * (R009/R012).
 *
 * Renders the body blocks of the parsed §15 document (footnote/endnote
 * blocks are skipped — they live in note parts, not the reading view). When
 * an issue is selected, the block its `sourceLoc.blockId` resolves to is
 * rendered through the T4 `highlightParts` helper: the exact source span
 * becomes `<mark class="source-highlight" data-testid="source-highlight">`
 * tinted by the issue severity, and the block is scrolled to the viewport
 * center. Span-less (entry-scoped) issues highlight the WHOLE block
 * (MEM074 — the UI never guesses a span). A sourceLoc pointing at a missing
 * block renders plain — never a fabricated highlight (§79).
 *
 * M005-S02-T4 (Tailwind v4): redesign per UI-SPEC mockup 5.4 — scrollable
 * block list, severity-tinted mark. testids + logic FROZEN.
 *
 * data-testid contract (FROZEN for T6 e2e): doc-view, source-highlight.
 */

import { useEffect, useRef } from 'react';
import type { AcademicDocument, LintIssue } from '@citesync/core';
import { highlightParts, sourceSpanForIssue } from '../explorer/explorer';
import { useI18n } from '../i18n/useI18n';

/** Footnote/endnote blocks are note parts — excluded from the reading view. */
function isBodyBlock(block: AcademicDocument['blocks'][number]): boolean {
  return block.type !== 'footnote' && block.type !== 'endnote';
}

const SEVERITY_CLASS: Record<LintIssue['severity'], string> = {
  ERROR: 'error',
  WARNING: 'warning',
  AMBIGUOUS: 'ambiguous',
  INFO: 'info',
};

/** Tailwind mark tint per severity (source-highlight-{severity} class kept). */
const MARK_CLASS: Record<LintIssue['severity'], string> = {
  ERROR: 'bg-severity-error-tint text-severity-error',
  WARNING: 'bg-severity-warning-tint text-severity-warning',
  AMBIGUOUS: 'bg-severity-ambiguous-tint text-severity-ambiguous',
  INFO: 'bg-severity-info-tint text-severity-info',
};

export interface DocumentViewProps {
  /** The parsed document (from the done envelope). */
  doc: AcademicDocument;
  /** The issue currently selected (undefined = no highlight). */
  selectedIssue?: LintIssue;
  /** Called when the user clicks the highlighted mark (re-select). */
  onSelect: (issueId: string) => void;
}

export default function DocumentView({ doc, selectedIssue, onSelect }: DocumentViewProps) {
  const { t } = useI18n();
  const blocks = doc.blocks.filter(isBodyBlock);
  const blockRefs = useRef(new Map<string, HTMLElement>());

  const issue = selectedIssue;
  const span = issue === undefined ? null : sourceSpanForIssue(doc, issue);
  const highlightBlockId = span?.block.id;

  // Scroll the highlighted block to the viewport center when the selection
  // changes (deterministic — no animation, so e2e can assert the target).
  useEffect(() => {
    if (highlightBlockId === undefined) return;
    const el = blockRefs.current.get(highlightBlockId);
    if (el !== undefined) el.scrollIntoView({ block: 'center' });
  }, [highlightBlockId]);

  return (
    <section
      className="doc-view min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm"
      data-testid="doc-view"
      aria-label={t('explorer.doc-aria-label')}
    >
      <h2 className="m-0 mb-3 font-display text-lg font-semibold text-ink">
        {t('explorer.doc-title')}
      </h2>
      {blocks.length === 0 ? (
        <p className="doc-view-empty m-0 text-sm text-muted">{t('explorer.doc-empty')}</p>
      ) : (
        <div className="doc-view-scroll max-h-[460px] space-y-0 overflow-y-auto rounded-md border border-border bg-subtle p-1 px-3">
          {blocks.map((block) => {
            const parts =
              issue !== undefined && span !== null && block.id === span.block.id
                ? highlightParts(block.text, span.start, span.end)
                : null;
            const isHighlighted = parts !== null;
            return (
              <p
                key={block.id}
                ref={(el) => {
                  if (el === null) blockRefs.current.delete(block.id);
                  else blockRefs.current.set(block.id, el);
                }}
                className={`doc-block m-0 border-b border-border px-1 py-2 text-sm leading-normal last:border-b-0 ${
                  isHighlighted ? 'doc-block-highlighted rounded bg-highlight px-2' : ''
                }`}
              >
                {parts !== null && issue !== undefined ? (
                  <>
                    {parts.before}
                    <mark
                      className={`source-highlight source-highlight-${SEVERITY_CLASS[issue.severity]} cursor-pointer rounded px-1 ${MARK_CLASS[issue.severity]}`}
                      data-testid="source-highlight"
                      onClick={() => onSelect(issue.id)}
                    >
                      {parts.mark}
                    </mark>
                    {parts.after}
                  </>
                ) : (
                  block.text
                )}
              </p>
            );
          })}
        </div>
      )}
    </section>
  );
}
