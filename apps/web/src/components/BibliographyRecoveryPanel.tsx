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
    <section className="recovery-panel" data-testid="recovery-panel" aria-label={t('recovery.aria-label')}>
      <h2>{t('recovery.title')}</h2>
      <p className="recovery-explanation">{t('recovery.explanation')}</p>
      {candidates.length === 0 ? (
        <p className="recovery-empty">{t('recovery.no-candidates')}</p>
      ) : (
        <ul className="recovery-list">
          {candidates.map((candidate) => (
            <li
              key={candidate.blockId}
              className="recovery-candidate"
              data-testid={`recovery-candidate-${candidate.blockId}`}
            >
              <div className="recovery-candidate-main">
                <span className="recovery-heading">{candidate.heading}</span>
                <span className="recovery-type">{t(HEADING_TYPE_KEY[candidate.headingType])}</span>
                <span className="recovery-confidence">{candidate.confidence.toFixed(2)}</span>
              </div>
              <button
                type="button"
                className="recovery-use"
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
