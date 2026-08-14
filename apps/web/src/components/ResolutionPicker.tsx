/**
 * R013 (S03-T3) — the manual ambiguity-resolution picker for one selected
 * AMBIGUOUS issue.
 *
 * Rendered ONLY for a selected resolvable issue — the caller checks
 * `resolutionCandidatesForIssue(doc, issue) !== null` (CS001 MISSING_REFERENCE
 * and CS002/CS005 entry-scoped issues never reach it — §79 no-guess). One row
 * per candidate with the deterministic `referenceLabel` (the SAME label the
 * evidence panel's possible-references list and the resolved-row chip use —
 * all three always agree) + a choose button.
 *
 * The picker reflects the current choice: re-choosing updates the SAME
 * citationId — SessionResolution is keyed by citationId (T1/T2 upsert), so
 * the chosen row stays highlighted and the stored resolution is replaced,
 * never duplicated. All data is matcher data (R012 — NEVER LLM).
 *
 * data-testid contract (FROZEN for T5 e2e): resolution-picker,
 * resolution-candidate-{entryId}, resolution-choose-{entryId}.
 */

import { referenceLabel } from '../explorer/explorer';
import type { ReferenceEntry } from '../explorer/explorer';
import { useI18n } from '../i18n/useI18n';

export interface ResolutionPickerProps {
  /** The region-joined matchMap citationId the choice keys against (SessionResolution key). */
  citationId: string;
  /** The AMBIGUOUS row's candidate entries, in candidateEntryIds order (T1 surface). */
  candidates: readonly ReferenceEntry[];
  /** The currently chosen entry id for this citation (undefined = unresolved). */
  chosenEntryId?: string;
  /** Called with the chosen entry id (re-choosing updates the same citationId). */
  onChoose: (entryId: string) => void;
}

export default function ResolutionPicker({
  citationId,
  candidates,
  chosenEntryId,
  onChoose,
}: ResolutionPickerProps) {
  const { t } = useI18n();
  return (
    <section
      className="resolution-picker"
      data-testid="resolution-picker"
      data-citation-id={citationId}
      aria-label={t('resolution.aria-label')}
    >
      <h2>{t('resolution.title')}</h2>
      <p className="resolution-picker-hint">{t('resolution.hint')}</p>
      <ul className="resolution-candidates">
        {candidates.map((entry) => {
          const chosen = entry.id === chosenEntryId;
          return (
            <li
              key={entry.id}
              className={`resolution-candidate${chosen ? ' resolution-candidate-chosen' : ''}`}
              data-testid={`resolution-candidate-${entry.id}`}
            >
              <span className="resolution-candidate-label">{referenceLabel(entry)}</span>
              <button
                type="button"
                className={`resolution-choose${chosen ? ' resolution-choose-chosen' : ''}`}
                data-testid={`resolution-choose-${entry.id}`}
                aria-pressed={chosen}
                onClick={() => onChoose(entry.id)}
              >
                {chosen ? t('resolution.chosen') : t('resolution.choose')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
