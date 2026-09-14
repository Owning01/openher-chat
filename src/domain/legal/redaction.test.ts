import { describe, expect, it } from 'vitest';
import type { LegalCase } from '../types/legal';
import {
  composeCaseContent,
  deanonymize,
  redactCaseContent,
  redactLegalCase,
  type RedactableCase,
  type RedactCaseContentInput,
  type RedactionKind,
} from './redaction';

const INPUT: RedactCaseContentInput = {
  case: {
    parties: [
      {
        id: 'p1',
        name: 'Juan Pérez',
        role: 'plaintiff',
        taxId: '20-12345678-9',
        address: 'Av. Corrientes 1234, piso 5',
        representative: 'María de la Cruz',
      },
      {
        id: 'p2',
        name: 'Ana Gómez',
        role: 'defendant',
        taxId: '27.876.543',
        address: 'Calle Falsa 742',
      },
    ],
    facts: [
      {
        id: 'f1',
        statement: 'El actor escribió a juan.perez@example.com y dejó el teléfono 11 1234-5678.',
        certainty: 'certain',
      },
      {
        id: 'f2',
        statement: 'Transfirió al CBU 0170099020000012345678 con alias: juanperez.mp',
        certainty: 'probable',
      },
    ],
  },
  extraText: 'Domicilio alternativo: Av. Corrientes 1234, piso 5. Contacto: juan.perez@example.com.',
};

const SENSITIVE_VALUES = [
  'Juan Pérez',
  'María de la Cruz',
  'Ana Gómez',
  '20-12345678-9',
  '27.876.543',
  'Av. Corrientes 1234, piso 5',
  'Calle Falsa 742',
  'juan.perez@example.com',
  '11 1234-5678',
  '0170099020000012345678',
  'alias: juanperez.mp',
];

function kindsOf(input: RedactCaseContentInput): Set<RedactionKind> {
  const redacted = redactCaseContent(input);
  return new Set(redacted.mapping.entries.map((entry) => entry.kind));
}

describe('composeCaseContent', () => {
  it('serializa partes y hechos con todos los datos crudos', () => {
    const raw = composeCaseContent(INPUT);
    for (const value of SENSITIVE_VALUES) {
      expect(raw).toContain(value);
    }
  });
});

describe('redactCaseContent', () => {
  it('no deja ningún dato del mapping en el texto redactado', () => {
    const { text, mapping } = redactCaseContent(INPUT);
    expect(mapping.entries.length).toBeGreaterThan(0);
    for (const entry of mapping.entries) {
      expect(text).not.toContain(entry.value);
    }
    for (const value of SENSITIVE_VALUES) {
      expect(text).not.toContain(value);
    }
  });

  it('usa tokens estables por categoría', () => {
    const { text } = redactCaseContent(INPUT);
    expect(text).toContain('[CUIT-1]');
    expect(text).toContain('[DOC-1]');
    expect(text).toContain('[EMAIL-1]');
    expect(text).toContain('[TEL-1]');
    expect(text).toContain('[CBU-1]');
    expect(text).toContain('[CBU-2]');
    expect(text).toContain('[DOM-1]');
    expect(text).toContain('[DOM-2]');
    expect(text).toContain('[PERSONA-1]');
    expect(text).toContain('[PERSONA-3]');
  });

  it('reconoce todas las categorías del expediente', () => {
    const kinds = kindsOf(INPUT);
    for (const kind of ['person', 'doc', 'cuit', 'email', 'phone', 'cbu', 'address'] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it('reemplaza también en el texto extra', () => {
    const { text } = redactCaseContent(INPUT);
    expect(text).toContain('Domicilio alternativo: [DOM-1]');
    expect(text).toContain('Contacto: [EMAIL-1]');
  });

  it('es determinista entre corridas', () => {
    const first = redactCaseContent(INPUT);
    const second = redactCaseContent(INPUT);
    expect(first.text).toBe(second.text);
    expect(first.mapping.entries).toEqual(second.mapping.entries);
  });

  it('redacta un expediente vacío sin error', () => {
    const emptyCase: RedactableCase = { parties: [], facts: [] };
    const { text, mapping } = redactCaseContent({ case: emptyCase });
    expect(text).toBe('');
    expect(mapping.entries).toEqual([]);
  });
});

describe('deanonymize', () => {
  it('hace round-trip exacto del contenido compuesto', () => {
    const raw = composeCaseContent(INPUT);
    const { text, mapping } = redactCaseContent(INPUT);
    expect(text).not.toBe(raw);
    expect(deanonymize(text, mapping)).toBe(raw);
  });

  it('deja intactos los tokens desconocidos', () => {
    const { text, mapping } = redactCaseContent(INPUT);
    const withUnknown = `${text} [PERSONA-99]`;
    expect(deanonymize(withUnknown, mapping)).toContain('[PERSONA-99]');
  });

  it('sin mapping devuelve el texto tal cual', () => {
    expect(deanonymize('texto [DOC-1]', { entries: [] })).toBe('texto [DOC-1]');
  });
});

/** Expediente con PII en cada campo sensible: título, partes, hechos libres y fechas clave. */
const PII_CASE: LegalCase = {
  id: 'case-pii',
  title: 'Juan Carlos García c/ María López — reclamo DNI 12.345.678',
  status: 'active',
  jurisdiction: 'national',
  court: 'Juzgado Civil N° 7',
  matter: 'civil',
  clientRole: 'plaintiff',
  parties: [
    {
      id: 'p1',
      name: 'Juan Carlos García',
      role: 'plaintiff',
      taxId: '20-12345678-9',
      address: 'Av. Siempre Viva 742, CABA',
      representative: 'Laura Méndez',
    },
    {
      id: 'p2',
      name: 'María López',
      role: 'defendant',
      taxId: '27-87654321-5',
      address: 'Calle Falsa 123, piso 2',
    },
  ],
  facts: [
    {
      id: 'f1',
      statement: 'Juan Carlos García escribió a juan.garcia@example.com y citó a María López.',
      date: '2026-02-01',
      certainty: 'certain',
    },
    {
      id: 'f2',
      statement: 'Pagó con CUIT 20-12345678-9 en el domicilio de Calle Falsa 123, piso 2.',
      certainty: 'probable',
    },
  ],
  keyDates: [{ id: 'd1', label: 'Audiencia con Juan Carlos García', date: '2026-03-10' }],
  createdAt: 1,
  updatedAt: 2,
};

describe('redactLegalCase', () => {
  it('reemplaza la PII en título, partes, hechos y fechas clave con tokens estables', () => {
    const { redacted, mapping } = redactLegalCase(PII_CASE);
    expect(mapping.entries.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(redacted);
    for (const entry of mapping.entries) {
      expect(serialized).not.toContain(entry.value);
      expect(serialized).toContain(entry.token);
    }
    // El mismo valor recibe el mismo token en todos los campos (título, parte y hecho).
    expect(redacted.title).toContain('[PERSONA-1]');
    expect(redacted.parties[0]?.name).toBe('[PERSONA-1]');
    expect(redacted.facts[0]?.statement).toContain('[PERSONA-1]');
    expect(redacted.facts[0]?.statement).toContain('[EMAIL-1]');
    expect(redacted.parties[0]?.taxId).toBe('[CUIT-1]');
    expect(redacted.parties[0]?.address).toBe('[DOM-1]');
  });

  it('conserva intactos los campos estructurales que sostienen el ruteo del brief', () => {
    const { redacted } = redactLegalCase(PII_CASE);
    expect(redacted.id).toBe('case-pii');
    expect(redacted.jurisdiction).toBe('national');
    expect(redacted.matter).toBe('civil');
    expect(redacted.status).toBe('active');
    expect(redacted.clientRole).toBe('plaintiff');
    expect(redacted.createdAt).toBe(1);
    expect(redacted.updatedAt).toBe(2);
    expect(redacted.parties.map((party) => party.id)).toEqual(['p1', 'p2']);
    expect(redacted.parties.map((party) => party.role)).toEqual(['plaintiff', 'defendant']);
    expect(redacted.facts[0]?.date).toBe('2026-02-01');
    expect(redacted.facts.map((fact) => fact.certainty)).toEqual(['certain', 'probable']);
    expect(redacted.keyDates[0]?.date).toBe('2026-03-10');
    // El nombre genérico del juzgado no es PII y pasa intacto.
    expect(redacted.court).toBe('Juzgado Civil N° 7');
  });

  it('cada campo redactado vuelve al original con deanonymize (round-trip por campo)', () => {
    const { redacted, mapping } = redactLegalCase(PII_CASE);
    expect(deanonymize(redacted.title, mapping)).toBe(PII_CASE.title);
    expect(redacted.parties.map((party) => deanonymize(party.name, mapping))).toEqual(
      PII_CASE.parties.map((party) => party.name),
    );
    expect(redacted.facts.map((fact) => deanonymize(fact.statement, mapping))).toEqual(
      PII_CASE.facts.map((fact) => fact.statement),
    );
    const labels = redacted.keyDates.map((keyDate) => deanonymize(keyDate.label, mapping));
    expect(labels).toEqual(PII_CASE.keyDates.map((keyDate) => keyDate.label));
  });

  it('es determinista entre corridas', () => {
    const first = redactLegalCase(PII_CASE);
    const second = redactLegalCase(PII_CASE);
    expect(first.redacted).toEqual(second.redacted);
    expect(first.mapping.entries).toEqual(second.mapping.entries);
  });
});
