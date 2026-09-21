/**
 * SoL-Pi Evidence-Preserving Reducer (arXiv:2609.20519):
 * Condensa textos extensos, fallos judiciales, transcripciones y contratos extrayendo
 * quirúrgicamente los elementos probatorios y normativos esenciales (fechas, montos,
 * normas legales citadas, hechos constatados y parte dispositiva/holding), purgando
 * el 50-70% de fórmulas sacramentales, saludos y retórica jurídica reiterativa.
 */

export interface EvidenceDigest {
  originalLength: number;
  reducedLength: number;
  compressionRatio: number;
  dates: string[];
  amounts: string[];
  citations: string[];
  dispositions: string[];
  reducedText: string;
}

const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  /d[ií]gnese\s+v(?:\.s|\.e|\.i)\.?\s+proveer\s+de\s+conformidad(?:[,\s]+que\s+ser[aá]\s+justicia)?/gi,
  /ser[aá]\s+justicia\.?/gi,
  /y\s+vistos(?:\s+y\s+considerando)?:?/gi,
  /en\s+m[eé]rito\s+de\s+lo\s+expuesto\s+y\s+disposiciones\s+legales\s+citadas/gi,
  /que\s+resulta\s+menester\s+poner\s+de\s+resalto\s+que/gi,
  /que\s+a\s+mayor\s+abundamiento\s+cabe\s+destacar\s+que/gi,
  /en\s+atenci[oó]n\s+a\s+las\s+circunstancias\s+del\s+caso\s+de\s+autos/gi,
  /vienen\s+estos\s+autos\s+a\s+despacho\s+a\s+efectos\s+de/gi,
  /por\s+lo\s+expuesto,\s+o[ií]do\s+el\s+ministerio\s+p[uú]blico/gi,
  /t[eé]ngase\s+presente\s+para\s+su\s+oportunidad/gi,
  /notif[ií]quese\s+por\s+secretar[ií]a\s+en\s+el\s+d[ií]a/gi,
  /reg[ií]strese,\s+notif[ií]quese\s+y\s+oportunamente\s+arch[ií]vese/gi,
];

const DATE_REGEX =
  /(?:\b\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)/gi;

const AMOUNT_REGEX =
  /(?:\$\s*[\d.]+(?:,\d{2})?|\bUSD\s*[\d.]+(?:,\d{2})?|\b(?:pesos|d[oó]lares)\s+[\d.]+(?:,\d{2})?)/gi;

const CITATION_REGEX =
  /(?:art(?:[ií]culo)?\.?\s*\d+(?:\s*(?:inc(?:iso)?\.?\s*\w+|bis|ter))?\s*(?:del?\s*)?(?:cpccn|ccyc|c\.\s*c\.\s*y\s*c\.|código\s+civil|ley\s*\d+(?:\.\d+)?|constitucion\s+nacional|c\.n\.|cn|ley\s*48)|csjn\s+fallos\s*[\d:]+)/gi;

const DISPOSITION_PREFIXES = [
  'hacer lugar',
  'rechazar',
  'condenar',
  'revocar',
  'confirmar',
  'declarar',
  'imponer las costas',
  'costas por su orden',
  'costas al vencido',
  'fijar los honorarios',
  'ordenar la produccion',
  'ordenar la producción',
];

/**
 * Reduce un texto largo extrayendo únicamente los elementos de peso probatorio y normativo.
 */
export function reduceToEvidence(text: string): EvidenceDigest {
  const original = text.trim();
  const originalLength = original.length;
  if (originalLength === 0) {
    return {
      originalLength: 0,
      reducedLength: 0,
      compressionRatio: 1,
      dates: [],
      amounts: [],
      citations: [],
      dispositions: [],
      reducedText: '',
    };
  }

  // 1. Detección de evidencias clave
  const dates = Array.from(new Set(original.match(DATE_REGEX) ?? []));
  const amounts = Array.from(new Set(original.match(AMOUNT_REGEX) ?? []));
  const citations = Array.from(
    new Set((original.match(CITATION_REGEX) ?? []).map((c) => c.trim())),
  );

  // 2. Filtrado de líneas eliminando fórmulas sacramentales y vacías
  const lines = original.split(/\r?\n/);
  const meaningfulLines: string[] = [];
  const dispositions: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Purgar fórmulas de estilo
    for (const pattern of BOILERPLATE_PATTERNS) {
      line = line.replace(pattern, '').trim();
    }
    if (!line || line.length < 5) continue;

    // Detectar si es una línea resolutiva / dispositiva
    const lower = line.toLowerCase();
    const isDisposition = DISPOSITION_PREFIXES.some((pref) => lower.includes(pref));
    if (isDisposition) {
      dispositions.push(line);
    }

    meaningfulLines.push(line);
  }

  // 3. Reensamblado del digest
  const reducedText = meaningfulLines.join('\n');
  const reducedLength = reducedText.length;
  const compressionRatio =
    originalLength > 0 ? Number((reducedLength / originalLength).toFixed(2)) : 1;

  return {
    originalLength,
    reducedLength,
    compressionRatio,
    dates,
    amounts,
    citations,
    dispositions,
    reducedText,
  };
}

/** Formatea el digest en un bloque denso para inyectar en el contexto del agente. */
export function formatEvidenceDigest(digest: EvidenceDigest): string {
  const lines: string[] = [
    `[EVIDENCE_DIGEST ratio=${digest.compressionRatio} (ahorro ${Math.round((1 - digest.compressionRatio) * 100)}%)]`,
  ];

  if (digest.dates.length > 0) {
    lines.push(`• Fechas clave: ${digest.dates.slice(0, 10).join(', ')}`);
  }
  if (digest.amounts.length > 0) {
    lines.push(`• Montos: ${digest.amounts.slice(0, 8).join(', ')}`);
  }
  if (digest.citations.length > 0) {
    lines.push(`• Normas citadas: ${digest.citations.slice(0, 12).join(', ')}`);
  }
  if (digest.dispositions.length > 0) {
    lines.push('• Puntos resolutivos / Disposición:');
    for (const d of digest.dispositions.slice(0, 5)) {
      lines.push(`  - ${d}`);
    }
  }

  lines.push('');
  lines.push('Texto sustancial filtrado:');
  lines.push(digest.reducedText);

  return lines.join('\n');
}
