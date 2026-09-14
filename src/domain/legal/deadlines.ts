import type { DeadlineItem, DeadlineRule, HolidayCalendar } from '../types/legal';

// ---------------------------------------------------------------------------
// Motor puro de cómputo de plazos.
//
// Fechas en UTC y formato date-only (`YYYY-MM-DD`) para no depender de la zona
// horaria ni sufrir corrimientos por DST. Todo el módulo es determinista salvo
// el campo `expired` cuando no se inyecta `today` (en ese caso se usa la fecha
// UTC actual como último recurso).
// ---------------------------------------------------------------------------

/** Regla con nota editorial; el tipo base congelado no declara `notes`. */
export type DeadlineRuleLike = DeadlineRule & { readonly notes?: string };

/** Vencimiento calculado con banderas derivadas. */
export interface ComputedDeadlineItem extends DeadlineItem {
  /** `true` si `dueDate` es anterior a `today` (vencer hoy todavía no es vencer). */
  expired: boolean;
  /** Días hábiles abarcados entre el inicio (exclusivo) y el vencimiento (inclusive). */
  businessDays: number;
  /** Ancla de origen cuando el ítem se deriva de `computePrescriptionTable`. */
  anchorId?: string;
}

/** Entrada del cómputo de un vencimiento puntual. */
export interface DeadlineInput {
  rule: DeadlineRuleLike;
  /** Ancla del cómputo (ISO `YYYY-MM-DD`, p. ej. la fecha de exigibilidad). */
  anchor: string;
  calendar?: HolidayCalendar;
  /** Fecha de referencia para marcar `expired`; inyectable en tests. */
  today?: string;
  caseId?: string;
}

/** Entrada de la tabla de prescripción: anclas × reglas aplicables. */
export interface PrescriptionTableInput {
  anchors: { id: string; label: string; date: string }[];
  rules: DeadlineRule[];
  calendar?: HolidayCalendar;
  today?: string;
  caseId?: string;
}

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida fecha `YYYY-MM-DD` incluyendo meses/días reales (rechaza 2023-02-30). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function toUtcDate(value: string): Date {
  return new Date(
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))),
  );
}

/** Serializa una fecha UTC a `YYYY-MM-DD`. */
export function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addCalendarDays(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * MS_PER_DAY);
}

/** Suma meses con ajuste de fin de mes (31/01 + 1 mes = 28/29 de febrero). */
export function addMonths(date: Date, amount: number): Date {
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + amount;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

/** Suma años con ajuste de 29 de febrero (29/02/2024 + 1 año = 28/02/2025). */
export function addYears(date: Date, amount: number): Date {
  return addMonths(date, amount * 12);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isHoliday(date: Date, calendar?: HolidayCalendar): boolean {
  if (!calendar) return false;
  return calendar.holidays.includes(formatIsoDate(date));
}

function isInJudicialRecess(date: Date, calendar?: HolidayCalendar): boolean {
  if (!calendar) return false;
  const day = formatIsoDate(date);
  return calendar.judicialRecess.some((recess) => day >= recess.from && day <= recess.to);
}

/** Día hábil = no fin de semana, no feriado y fuera de feria judicial. */
export function isBusinessDay(date: Date, calendar?: HolidayCalendar): boolean {
  return !isWeekend(date) && !isHoliday(date, calendar) && !isInJudicialRecess(date, calendar);
}

/** Avanza `amount` días hábiles contando desde el día siguiente al inicio. */
export function addBusinessDays(start: Date, amount: number, calendar?: HolidayCalendar): Date {
  let cursor = start;
  let counted = 0;
  while (counted < amount) {
    cursor = addCalendarDays(cursor, 1);
    if (isBusinessDay(cursor, calendar)) counted += 1;
  }
  return cursor;
}

/** Cuenta días hábiles en el intervalo (inicio exclusivo, fin inclusive). */
export function countBusinessDays(from: Date, to: Date, calendar?: HolidayCalendar): number {
  let cursor = from;
  let counted = 0;
  while (cursor.getTime() < to.getTime()) {
    cursor = addCalendarDays(cursor, 1);
    if (isBusinessDay(cursor, calendar)) counted += 1;
  }
  return counted;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function computeDue(
  start: Date,
  rule: DeadlineRuleLike,
  calendar?: HolidayCalendar,
): { due: Date; countedDays: number } {
  switch (rule.unit) {
    case 'calendar-days': {
      const due = addCalendarDays(start, rule.days);
      return { due, countedDays: rule.days };
    }
    case 'business-days': {
      const due = addBusinessDays(start, rule.days, calendar);
      return { due, countedDays: rule.days };
    }
    case 'months': {
      const due = addMonths(start, rule.days);
      return { due, countedDays: daysBetween(start, due) };
    }
    case 'years': {
      const due = addYears(start, rule.days);
      return { due, countedDays: daysBetween(start, due) };
    }
    default:
      return { due: start, countedDays: 0 };
  }
}

/**
 * Calcula el vencimiento de una regla desde un ancla.
 * Degrada sin lanzar: ancla inválida o importe inválido devuelven el ancla como
 * vencimiento con `countedDays: 0` y una nota. `days: 0` marca imprescriptible.
 */
export function computeDeadline(input: DeadlineInput): ComputedDeadlineItem {
  const { rule, calendar } = input;
  const today = input.today ?? currentUtcDate();
  const base = {
    id: `${rule.id}@${input.anchor}`,
    caseId: input.caseId ?? '',
    ruleId: rule.id,
    label: rule.label,
    startDate: input.anchor,
    unit: rule.unit,
    amount: rule.days,
    verified: rule.verified,
  };

  if (!isValidIsoDate(input.anchor) || !Number.isFinite(rule.days) || rule.days < 0) {
    return {
      ...base,
      dueDate: input.anchor,
      countedDays: 0,
      businessDays: 0,
      expired: false,
      note: 'ancla o importe inválido: no se computó el vencimiento',
    };
  }

  if (rule.days === 0) {
    return {
      ...base,
      dueDate: input.anchor,
      countedDays: 0,
      businessDays: 0,
      expired: false,
      note: rule.notes ?? 'sin vencimiento (imprescriptible)',
    };
  }

  const start = toUtcDate(input.anchor);
  const { due, countedDays } = computeDue(start, rule, calendar);
  const dueDate = formatIsoDate(due);
  const businessDays = countBusinessDays(start, due, calendar);
  const expired = isValidIsoDate(today) && dueDate < today;

  return {
    ...base,
    dueDate,
    countedDays,
    businessDays,
    expired,
    note: rule.notes,
  };
}

/**
 * Cruza anclas (fechas clave del caso) con las reglas aplicables.
 * Ordena por vencimiento, luego regla y ancla, para una tabla estable.
 */
export function computePrescriptionTable(input: PrescriptionTableInput): ComputedDeadlineItem[] {
  const items: ComputedDeadlineItem[] = [];
  for (const anchor of input.anchors) {
    for (const rule of input.rules) {
      const item = computeDeadline({
        rule,
        anchor: anchor.date,
        calendar: input.calendar,
        today: input.today,
        caseId: input.caseId,
      });
      items.push({
        ...item,
        id: `${anchor.id}:${rule.id}`,
        label: `${anchor.label} — ${rule.label}`,
        anchorId: anchor.id,
      });
    }
  }
  items.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.ruleId.localeCompare(b.ruleId) ||
      (a.anchorId ?? '').localeCompare(b.anchorId ?? ''),
  );
  return items;
}
