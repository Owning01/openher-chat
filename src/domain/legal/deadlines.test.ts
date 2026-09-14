import { describe, expect, it } from 'vitest';
import type { DeadlineRule, HolidayCalendar } from '../types/legal';
import {
  addBusinessDays,
  addMonths,
  addYears,
  computeDeadline,
  computePrescriptionTable,
  countBusinessDays,
  formatIsoDate,
  isValidIsoDate,
  type ComputedDeadlineItem,
} from './deadlines';
import {
  CADUCIDAD_RULES_NATIONAL,
  CCYC_SOURCE_URL,
  CPCCN_SOURCE_URL,
  DEADLINE_RULES_BY_JURISDICTION,
  PRESCRIPTION_RULES_CABA,
  PRESCRIPTION_RULES_NATIONAL,
  resolveDeadlineRules,
} from './rules';

const JURISDICTIONS = ['national', 'caba', 'pba', 'cordoba'] as const;

function customRule(
  overrides: Partial<DeadlineRule> & Pick<DeadlineRule, 'unit' | 'days'>,
): DeadlineRule {
  return {
    id: 'custom',
    jurisdiction: 'national',
    scope: 'test',
    normRef: 'test',
    from: 'notification',
    verified: false,
    sourceUrl: 'https://example.invalid/test',
    label: 'Plazo de prueba',
    ...overrides,
  };
}

function ruleOf(id: string): DeadlineRule {
  const found = PRESCRIPTION_RULES_NATIONAL.find((rule) => rule.id === id);
  if (!found) throw new Error(`regla no encontrada: ${id}`);
  return found;
}

function itemFor(
  items: ComputedDeadlineItem[],
  anchorId: string,
  ruleId: string,
): ComputedDeadlineItem {
  const found = items.find((item) => item.anchorId === anchorId && item.ruleId === ruleId);
  if (!found) throw new Error(`ítem no encontrado: ${anchorId}/${ruleId}`);
  return found;
}

const CALENDAR_2024: HolidayCalendar = {
  jurisdiction: 'national',
  year: 2024,
  holidays: ['2024-05-02'],
  judicialRecess: [],
  verified: false,
};

describe('fechas UTC date-only', () => {
  it('valida fechas reales y rechaza imposibles', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2023-02-29')).toBe(false);
    expect(isValidIsoDate('2023-02-30')).toBe(false);
    expect(isValidIsoDate('2024-13-01')).toBe(false);
    expect(isValidIsoDate('garbage')).toBe(false);
  });

  it('suma meses con ajuste de fin de mes', () => {
    expect(formatIsoDate(addMonths(new Date(Date.UTC(2024, 0, 31)), 1))).toBe('2024-02-29');
    expect(formatIsoDate(addMonths(new Date(Date.UTC(2023, 0, 31)), 1))).toBe('2023-02-28');
  });

  it('suma años con ajuste de 29 de febrero', () => {
    expect(formatIsoDate(addYears(new Date(Date.UTC(2024, 1, 29)), 1))).toBe('2025-02-28');
  });

  it('cuenta y avanza días hábiles con feriados y ferias', () => {
    const start = new Date(Date.UTC(2024, 4, 1)); // miércoles 2024-05-01
    expect(formatIsoDate(addBusinessDays(start, 3, CALENDAR_2024))).toBe('2024-05-07');
    expect(countBusinessDays(start, new Date(Date.UTC(2024, 4, 7)), CALENDAR_2024)).toBe(3);

    const friday = new Date(Date.UTC(2024, 4, 3));
    expect(formatIsoDate(addBusinessDays(friday, 1))).toBe('2024-05-06');

    const recess: HolidayCalendar = {
      jurisdiction: 'national',
      year: 2024,
      holidays: [],
      judicialRecess: [{ from: '2024-05-06', to: '2024-05-10', label: 'feria' }],
      verified: false,
    };
    expect(formatIsoDate(addBusinessDays(friday, 2, recess))).toBe('2024-05-14');
  });
});

describe('computeDeadline', () => {
  it('computa días corridos', () => {
    const item = computeDeadline({
      rule: customRule({ unit: 'calendar-days', days: 2 }),
      anchor: '2024-02-28',
      today: '2024-03-01',
    });
    expect(item.dueDate).toBe('2024-03-01');
    expect(item.countedDays).toBe(2);
    expect(item.expired).toBe(false);
  });

  it('computa días hábiles saltando fin de semana, feriado y feria', () => {
    const item = computeDeadline({
      rule: customRule({ unit: 'business-days', days: 3 }),
      anchor: '2024-05-01',
      calendar: CALENDAR_2024,
      today: '2024-05-01',
    });
    expect(item.dueDate).toBe('2024-05-07');
    expect(item.countedDays).toBe(3);
    expect(item.businessDays).toBe(3);
  });

  it('computa meses y años con ajuste de fin de mes y bisiesto', () => {
    const monthly = computeDeadline({
      rule: customRule({ unit: 'months', days: 1 }),
      anchor: '2024-01-31',
      today: '2024-01-31',
    });
    expect(monthly.dueDate).toBe('2024-02-29');

    const fiveYears = computeDeadline({
      rule: ruleOf('ccyc-2560-prescripcion-generica'),
      anchor: '2020-02-29',
      today: '2025-02-28',
    });
    expect(fiveYears.dueDate).toBe('2025-02-28');
    expect(fiveYears.verified).toBe(true);
  });

  it('marca vencido sólo cuando dueDate es anterior a today', () => {
    const input = {
      rule: ruleOf('ccyc-2560-prescripcion-generica'),
      anchor: '2020-01-01',
    };
    expect(computeDeadline({ ...input, today: '2024-12-31' }).expired).toBe(false);
    expect(computeDeadline({ ...input, today: '2025-01-01' }).expired).toBe(false);
    expect(computeDeadline({ ...input, today: '2025-01-02' }).expired).toBe(true);
  });

  it('trata days: 0 como imprescriptible (art. 2561, lesa humanidad)', () => {
    const item = computeDeadline({
      rule: ruleOf('ccyc-2561-lesa-humanidad'),
      anchor: '2000-01-01',
      today: '2030-01-01',
    });
    expect(item.amount).toBe(0);
    expect(item.dueDate).toBe('2000-01-01');
    expect(item.countedDays).toBe(0);
    expect(item.expired).toBe(false);
    expect(item.note).toBeTruthy();
    expect(item.verified).toBe(true);
  });

  it('degrada sin lanzar con ancla o importe inválidos', () => {
    const invalid = computeDeadline({
      rule: ruleOf('ccyc-2560-prescripcion-generica'),
      anchor: '2023-02-30',
      today: '2030-01-01',
    });
    expect(invalid.countedDays).toBe(0);
    expect(invalid.businessDays).toBe(0);
    expect(invalid.expired).toBe(false);
    expect(invalid.note).toBeTruthy();

    const negative = computeDeadline({
      rule: customRule({ unit: 'years', days: -1 }),
      anchor: '2024-01-01',
      today: '2030-01-01',
    });
    expect(negative.countedDays).toBe(0);
    expect(negative.expired).toBe(false);
  });
});

describe('computePrescriptionTable', () => {
  it('cruza anclas con reglas y ordena por vencimiento', () => {
    const items = computePrescriptionTable({
      anchors: [
        { id: 'a1', label: 'Exigibilidad', date: '2020-01-01' },
        { id: 'a2', label: 'Servicio', date: '2021-06-15' },
      ],
      rules: [
        ruleOf('ccyc-2560-prescripcion-generica'),
        ruleOf('ccyc-2562-nulidad-relativa-revision'),
      ],
      today: '2026-01-01',
    });
    expect(items).toHaveLength(4);
    expect(items[0]?.dueDate).toBe('2022-01-01');
    expect(itemFor(items, 'a1', 'ccyc-2560-prescripcion-generica').dueDate).toBe('2025-01-01');
    expect(itemFor(items, 'a2', 'ccyc-2560-prescripcion-generica').expired).toBe(false);
    expect(itemFor(items, 'a2', 'ccyc-2562-nulidad-relativa-revision').expired).toBe(true);
    for (const item of items) {
      expect(item.anchorId === 'a1' || item.anchorId === 'a2').toBe(true);
      expect(item.businessDays).toBeGreaterThanOrEqual(0);
      expect(typeof item.expired).toBe('boolean');
    }
  });

  it('devuelve lista vacía sin anclas o reglas', () => {
    expect(computePrescriptionTable({ anchors: [], rules: PRESCRIPTION_RULES_NATIONAL })).toEqual([]);
    expect(computePrescriptionTable({ anchors: [{ id: 'a', label: 'x', date: '2024-01-01' }], rules: [] })).toEqual([]);
  });
});

describe('reglas versionadas', () => {
  it('toda la prescripción CCyC está verificada con fuente oficial', () => {
    expect(PRESCRIPTION_RULES_NATIONAL).toHaveLength(16);
    for (const rule of PRESCRIPTION_RULES_NATIONAL) {
      expect(rule.verified).toBe(true);
      expect(rule.sourceUrl).toBe(CCYC_SOURCE_URL);
      expect(rule.jurisdiction).toBe('national');
      expect(rule.scope).toBe('prescription');
      expect(rule.normRef.startsWith('CCyC art. 25')).toBe(true);
      expect(rule.days).toBeGreaterThanOrEqual(0);
    }
  });

  it('cada supuesto del 2562 y del 2564 tiene su propia regla', () => {
    const art2562 = PRESCRIPTION_RULES_NATIONAL.filter((rule) => rule.normRef === 'CCyC art. 2562');
    const art2564 = PRESCRIPTION_RULES_NATIONAL.filter((rule) => rule.normRef === 'CCyC art. 2564');
    const art2561 = PRESCRIPTION_RULES_NATIONAL.filter((rule) => rule.normRef === 'CCyC art. 2561');
    expect(art2562).toHaveLength(6);
    expect(art2564).toHaveLength(6);
    expect(art2561).toHaveLength(3);
    for (const rule of art2562) {
      expect(rule.days).toBe(2);
      expect(rule.unit).toBe('years');
    }
    for (const rule of art2564) {
      expect(rule.days).toBe(1);
      expect(rule.unit).toBe('years');
    }
  });

  it('la caducidad del CPCCN queda sin verificar y con fuente citada', () => {
    expect(CADUCIDAD_RULES_NATIONAL).toHaveLength(3);
    for (const rule of CADUCIDAD_RULES_NATIONAL) {
      expect(rule.verified).toBe(false);
      expect(rule.sourceUrl).toBe(CPCCN_SOURCE_URL);
      expect(rule.unit).toBe('months');
      expect(rule.normRef).toBe('CPCCN art. 310');
    }
  });

  it('CABA no inventa plazos en el MVP', () => {
    expect(PRESCRIPTION_RULES_CABA).toEqual([]);
    expect(resolveDeadlineRules('caba')).toEqual([]);
    expect(resolveDeadlineRules('pba')).toEqual([]);
    expect(resolveDeadlineRules('cordoba')).toEqual([]);
  });

  it('resuelve por jurisdicción y ninguna regla no-CCyC figura verificada', () => {
    expect(resolveDeadlineRules('national')).toHaveLength(
      PRESCRIPTION_RULES_NATIONAL.length + CADUCIDAD_RULES_NATIONAL.length,
    );
    expect(DEADLINE_RULES_BY_JURISDICTION.national).toHaveLength(19);
    for (const jurisdiction of JURISDICTIONS) {
      for (const rule of resolveDeadlineRules(jurisdiction)) {
        if (rule.verified) {
          expect(rule.scope).toBe('prescription');
          expect(rule.normRef.startsWith('CCyC art. ')).toBe(true);
        }
      }
    }
  });
});
