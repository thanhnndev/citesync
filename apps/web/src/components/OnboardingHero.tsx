/**
 * M005-S02-T4 — the idle hero (UI-SPEC mockup 5.1/5.9).
 *
 * Rendered ONLY at idle (App gates it): value proposition + privacy badges
 * that make a first-time visitor understand the app in ~5 seconds and trust
 * the offline-first claim (PRD §58 hero, §59 product proof). Purely static
 * copy through i18n — no state, no testids (visual surface only).
 *
 * Design: 'Scholarly Precision' — Fraunces display heading, generous
 * whitespace, staggered fade-in (feel-better: split + stagger ~100ms).
 */

import { useI18n } from '../i18n/useI18n';
import { CodeIcon, DeviceIcon, ShieldIcon, UserIcon } from './icons';

const PRIVACY_BADGES: readonly { Icon: typeof ShieldIcon; title: string; hint: string }[] = [
  { Icon: ShieldIcon, title: '100% local', hint: 'Nothing is uploaded' },
  { Icon: UserIcon, title: 'No account', hint: 'No sign-up needed' },
  { Icon: DeviceIcon, title: 'Your file stays yours', hint: 'Processed in your browser' },
  { Icon: CodeIcon, title: 'Open source', hint: 'Inspect every byte' },
];

export default function OnboardingHero() {
  const { t } = useI18n();
  return (
    <section className="onboarding-hero mx-auto max-w-2xl pt-6 text-center">
      <h2 className="m-0 font-display text-3xl font-semibold leading-tight text-balance text-ink md:text-4xl">
        {t('onboarding.hero-title')}
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-pretty text-base text-muted">
        {t('onboarding.hero-subtitle')}
      </p>
      <ul className="mt-8 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-4">
        {PRIVACY_BADGES.map(({ Icon, title, hint }, index) => (
          <li
            key={title}
            className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface px-3 py-4 shadow-sm"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <Icon className="h-5 w-5 text-accent" />
            <span className="text-sm font-semibold text-ink">{title}</span>
            <span className="text-xs text-muted">{hint}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
