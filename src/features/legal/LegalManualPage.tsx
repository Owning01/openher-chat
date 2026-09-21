import { LegalManual } from './components/LegalManual';

export function LegalManualPage() {
  return (
    <section
      data-testid="legal-manual-page"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background"
    >
      <div className="w-full flex-1 py-4 sm:py-6">
        <LegalManual />
      </div>
    </section>
  );
}
