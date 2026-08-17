/**
 * T5 — the evidence panel for one selected issue (R012).
 *
 * Renders the issue's deterministic evidence items VERBATIM: a code badge
 * (matcher `MatchReason` / `RuleEvidenceCode` — machine-readable, NEVER LLM
 * output, R012) + the template-derived `evidence.message` + the source block
 * the evidence points at (block text, truncated; block id fallback). Below
 * the evidence, the possible-references list joins the issue's source region
 * against the match/numeric maps (T4 `possibleReferencesForIssue` — matcher
 * data only, §79 no-guess). An empty join renders "No references matched".
 *
 * M005-S02-T4 (Tailwind v4): redesign per UI-SPEC mockup 5.5 — code badge,
 * message, italic source, possible-refs with accent left-border. testids +
 * logic FROZEN.
 *
 * data-testid contract (FROZEN for T6 e2e): evidence-panel,
 * evidence-code-{code}, possible-ref-{entryId}.
 */

import type { AcademicDocument, LintIssue } from '@citesync/core';
import { possibleReferencesForIssue, referenceLabel } from '../explorer/explorer';
import type { ReferenceEntry } from '../explorer/explorer';
import { useI18n } from '../i18n/useI18n';

const MAX_BLOCK_LABEL = 72;
const MAX_REFERENCE_LABEL = 160;

/** Truncate a string with a trailing ellipsis (UTF-16 safe, MEM013). */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;
}

/** The source-block label of a location: the block text, else the block id. */
function blockLabel(doc: AcademicDocument, blockId: string): string {
  const block = doc.blocks.find((b) => b.id === blockId);
  return block === undefined ? blockId : truncate(block.text, MAX_BLOCK_LABEL);
}

/**
 * R013-T3: `referenceLabel` moved to explorer.ts as the single shared
 * deterministic entry label (picker + chip + possible-refs all agree). The
 * panel keeps its own truncation wrapper only.
 */
export interface EvidencePanelProps {
  /** The selected issue whose evidence + references are shown. */
  issue: LintIssue;
  /** The parsed document (source blocks + maps the join reads). */
  doc: AcademicDocument;
}

export default function EvidencePanel({ issue, doc }: EvidencePanelProps) {
  const { t } = useI18n();
  const references = possibleReferencesForIssue(doc, issue);
  return (
    <section
      className="evidence-panel min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm"
      data-testid="evidence-panel"
      aria-label={t('evidence.aria-label')}
    >
      <h2 className="m-0 mb-2 font-display text-lg font-semibold text-ink">
        {t('evidence.title')}
      </h2>
      <p className="evidence-issue m-0 mb-3 flex gap-2 text-sm">
        <code className="evidence-issue-id shrink-0 font-mono text-xs text-muted">
          {issue.id}
        </code>
        <span className="evidence-issue-message min-w-0 text-pretty text-ink">
          {issue.message}
        </span>
      </p>
      <ul className="evidence-list m-0 mb-4 flex list-none flex-col gap-2 p-0">
        {issue.evidence.map((evidence, index) => (
          <li
            key={`${evidence.code}-${index}`}
            className="evidence-item grid gap-1 rounded-md border border-border bg-subtle p-3"
          >
            <code
              className="evidence-code col-span-full font-mono text-xs font-medium text-accent"
              data-testid={`evidence-code-${evidence.code}`}
            >
              {evidence.code}
            </code>
            <span className="evidence-message text-sm leading-normal text-ink">
              {evidence.message}
            </span>
            <span className="evidence-source col-span-full text-sm italic text-muted">
              {blockLabel(doc, evidence.source.blockId)}
            </span>
          </li>
        ))}
      </ul>
      <h3 className="evidence-references-heading m-0 mb-1 text-sm font-semibold text-ink">
        {t('evidence.possible-references')}
      </h3>
      {references.length === 0 ? (
        <p className="evidence-empty-refs m-0 text-sm text-muted">{t('evidence.no-refs')}</p>
      ) : (
        <ul className="reference-list m-0 flex list-none flex-col gap-1 p-0">
          {references.map((entry) => (
            <li
              key={entry.id}
              className="reference-entry border-l-[3px] border-border px-2 py-1 text-sm leading-normal text-ink"
              data-testid={`possible-ref-${entry.id}`}
            >
              {truncate(referenceLabel(entry), MAX_REFERENCE_LABEL)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
