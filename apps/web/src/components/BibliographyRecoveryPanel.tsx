/**
 * T5 — the below-threshold bibliography recovery panel (PRD §63 ask-user,
 * D005/D009).
 *
 * Rendered ONLY when `doc.bibliography.outcome === 'below-threshold'`: the
 * detector found heading candidates but none cleared the conservative
 * threshold, so the engine NEVER guesses a section (R004 — no silent
 * selection below threshold). The panel lists the candidates with their
 * heading text, signal type and score, and lets the user pick one — App
 * re-runs the analysis with that heading's block id via
 * `rerun({ bibliographyBlockIds: [id] })` (the T3 recovery seam). All labels
 * are deterministic — no LLM anywhere (R012).
 *
 * M005-S02-T4 (Tailwind v4): redesign per UI-SPEC mockup 5.8 — candidate
 * cards + confidence mono + accent action. testids + logic FROZEN.
 *
 * data-testid contract (FROZEN for T6 e2e): recovery-panel,
 * recovery-candidate-{blockId}, recovery-use-{blockId}.
 */

import type { AcademicDocument } from '@citesync/core';
import { useI18n } from '../i18n/useI18n';
import type { I18nKey } from '../i18n/dictionary';

/** §17 bibliography section, derived from the core re-export (PRD §93). */
export type BibliographySection = NonNullable<AcademicDocument['bibliography']>;
/** §17 one heading candidate (derived — candidates is optional on the section). */
export type BibliographyCandidate = NonNullable<BibliographySection['candidates']>[number];

/**
 * Deterministic i18n key per candidate signal type — UI copy (goes through
 * i18n); the headingType VALUE is engine data and stays as-is.
 */
const HEADING_TYPE_KEY: Record<BibliographyCandidate['headingType'], I18nKey> = {
  exact: 'recovery.type.exact',
  style: 'recovery.type.style',
  position: 'recovery.type.position',
  'reference-segment': 'recovery.type.reference-segment',
  none: 'recovery.type.none',
};

export interface BibliographyRecoveryPanelProps {
  /** The below-threshold bibliography state (outcome === 'below-threshold'). */
  bibliography: BibliographySection;
  /** Called with the picked candidate's blockId → App re-runs with it. */
  onUseSection: (blockId: string) => void;
}

export default function BibliographyRecoveryPanel({
  bibliography,
  onUseSection,
}: BibliographyRecoveryPanelProps) {
  const { t } = useI18n();
  // Defensive: the panel is only wired by App for below-threshold outcomes,
  // but never render anything for a different outcome (never guess, §79).
  if (bibliography.outcome !== 'below-threshold') return null;
  const candidates = bibliography.candidates ?? [];
  return (
    <section
      className="recovery-panel rounded-lg border border-border bg-surface p-5 shadow-sm"
      data-testid="recovery-panel"
      aria-label={t('recovery.aria-label')}
    >
      <h2 className="m-0 mb-2 font-display text-lg font-semibold text-ink">
        {t('recovery.title')}
      </h2>
      <p className="recovery-explanation m-0 mb-4 text-sm text-muted">
        {t('recovery.explanation')}
      </p>
      {candidates.length === 0 ? (
        <p className="recovery-empty m-0 text-sm text-muted">{t('recovery.no-candidates')}</p>
      ) : (
        <ul className="recovery-list m-0 flex list-none flex-col gap-2 p-0">
          {candidates.map((candidate) => (
            <li
              key={candidate.blockId}
              className="recovery-candidate flex items-center justify-between gap-3 rounded-md border border-border bg-subtle p-3"
              data-testid={`recovery-candidate-${candidate.blockId}`}
            >
              <div className="recovery-candidate-main flex min-w-0 flex-col gap-1">
                <span className="recovery-heading text-sm font-semibold text-ink">
                  {candidate.heading}
                </span>
                <span className="recovery-type flex items-center gap-2 text-xs text-muted">
                  {t(HEADING_TYPE_KEY[candidate.headingType])}
                  <span className="recovery-confidence font-mono tabular-nums text-severity-ambiguous">
                    {candidate.confidence.toFixed(2)}
                  </span>
                </span>
              </div>
              <button
                type="button"
                className="recovery-use shrink-0 cursor-pointer rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-inverse transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                data-testid={`recovery-use-${candidate.blockId}`}
                onClick={() => onUseSection(candidate.blockId)}
              >
                {t('recovery.use')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
