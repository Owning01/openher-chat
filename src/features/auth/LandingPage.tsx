import { LOGIN_HREF, navigate } from '@/app/routing';
import { useT } from '@/i18n/useT';
import { ArrowRight, Globe, KeyRound, Scale, ShieldCheck, Sparkles } from '@/shared/icons';
import type { LucideIcon } from '@/shared/icons';
import { Button } from '@/shared/ui';

interface Feature {
  icon: LucideIcon;
  titleKey: 'auth.featureKeysTitle' | 'auth.featureResearchTitle' | 'auth.featureLegalTitle' | 'auth.featureLocalTitle';
  textKey: 'auth.featureKeysText' | 'auth.featureResearchText' | 'auth.featureLegalText' | 'auth.featureLocalText';
}

const FEATURES: readonly Feature[] = [
  { icon: KeyRound, titleKey: 'auth.featureKeysTitle', textKey: 'auth.featureKeysText' },
  { icon: Globe, titleKey: 'auth.featureResearchTitle', textKey: 'auth.featureResearchText' },
  { icon: Scale, titleKey: 'auth.featureLegalTitle', textKey: 'auth.featureLegalText' },
  { icon: ShieldCheck, titleKey: 'auth.featureLocalTitle', textKey: 'auth.featureLocalText' },
];

/**
 * Portada pública cuando hay auth configurada y no hay sesión: explica qué es
 * la app y ofrece la entrada a `#/login`. No pide ni muestra datos personales.
 */
export function LandingPage() {
  const t = useT();

  return (
    <main className="min-h-dvh bg-background text-text">
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
            <Sparkles aria-hidden="true" className="size-5 shrink-0 text-primary" />
            <span className="truncate">OpenHer Chat</span>
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11 shrink-0"
            onClick={() => navigate(LOGIN_HREF)}
          >
            {t('auth.landingCtaLogin')}
          </Button>
        </header>

        <div className="flex flex-1 flex-col justify-center gap-8 py-10">
          <div className="space-y-4 text-center">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
              <ShieldCheck aria-hidden="true" className="size-3.5 text-primary" />
              {t('auth.landingBadge')}
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              {t('auth.landingTitle')}
            </h1>
            <p className="mx-auto max-w-xl text-base text-pretty text-muted">{t('auth.landingSubtitle')}</p>
            <div className="flex flex-col items-center gap-2 pt-1">
              <Button
                type="button"
                size="lg"
                className="w-full px-6 sm:w-auto"
                onClick={() => navigate(LOGIN_HREF)}
              >
                {t('auth.landingCtaLogin')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
              <p className="text-xs text-muted">{t('auth.landingCtaNote')}</p>
            </div>
          </div>

          <figure
            aria-label={t('auth.sampleCaption')}
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
            <figcaption className="border-b border-border-subtle px-4 py-2 text-xs font-medium text-muted">
              {t('auth.sampleCaption')}
            </figcaption>
            <div className="space-y-3 p-4 text-sm">
              <blockquote className="rounded-lg bg-surface-subtle px-3 py-2 text-text">
                {t('auth.sampleQuestion')}
              </blockquote>
              <div className="space-y-2 px-1">
                <p>{t('auth.sampleAnswer')}</p>
                <p>
                  <span className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs text-primary">
                    {t('auth.sampleCite')}
                  </span>
                </p>
              </div>
            </div>
          </figure>

          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li
                key={feature.titleKey}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4"
              >
                <feature.icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 space-y-1">
                  <h2 className="text-sm font-semibold">{t(feature.titleKey)}</h2>
                  <p className="text-sm text-muted">{t(feature.textKey)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <footer className="pt-2 text-center text-xs text-muted">{t('auth.landingFooter')}</footer>
      </div>
    </main>
  );
}
