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
 * data-testid contract (FROZEN for T6 e2e): evidence-panel,
 * evidence-code-{code}, possible-ref-{entryId}.
 */

import type { AcademicDocument, LintIssue } from '@citesync/core';
import { possibleReferencesForIssue, referenceLabel } from '../explorer/explorer';
import type { ReferenceEntry } from '../explorer/explorer';

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
  const references = possibleReferencesForIssue(doc, issue);
  return (
    <section className="evidence-panel" data-testid="evidence-panel" aria-label="Issue evidence">
      <h2>Evidence</h2>
      <p className="evidence-issue">
        <code className="evidence-issue-id">{issue.id}</code>
        <span className="evidence-issue-message">{issue.message}</span>
      </p>
      <ul className="evidence-list">
        {issue.evidence.map((evidence, index) => (
          <li key={`${evidence.code}-${index}`} className="evidence-item">
            <code className="evidence-code" data-testid={`evidence-code-${evidence.code}`}>
              {evidence.code}
            </code>
            <span className="evidence-message">{evidence.message}</span>
            <span className="evidence-source">{blockLabel(doc, evidence.source.blockId)}</span>
          </li>
        ))}
      </ul>
      <h3 className="evidence-references-heading">Possible references</h3>
      {references.length === 0 ? (
        <p className="evidence-empty-refs">No references matched</p>
      ) : (
        <ul className="reference-list">
          {references.map((entry) => (
            <li
              key={entry.id}
              className="reference-entry"
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
