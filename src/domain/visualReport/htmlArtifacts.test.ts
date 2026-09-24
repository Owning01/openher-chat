import { describe, expect, it } from 'vitest';
import {
  addArtifactVersion,
  applyHtmlPatch,
  createHtmlArtifact,
  extractHtmlPatches,
  resolveMessageHtml,
  restoreArtifactVersion,
} from './htmlArtifacts';

describe('htmlArtifacts', () => {
  describe('extractHtmlPatches', () => {
    it('extrae bloques de parche con formato clásico git / aider', () => {
      const text = `
Aquí está la modificación solicitada:
\`\`\`html-patch
<<<<<<< SEARCH
<h1>Reporte Financiero</h1>
=======
<h1>Reporte Financiero Q3 2026</h1>
<p class="subtitle">Actualizado con balance general</p>
>>>>>>> REPLACE
\`\`\`
`;
      const patches = extractHtmlPatches(text);
      expect(patches).toHaveLength(1);
      expect(patches[0]?.search).toContain('<h1>Reporte Financiero</h1>');
      expect(patches[0]?.replace).toContain('Reporte Financiero Q3 2026');
    });

    it('extrae bloques de parche con formato simplificado de 4 marcas', () => {
      const text = `
<<<< SEARCH
<button>Enviar</button>
====
<button class="primary">Enviar Ahora</button>
>>>>
`;
      const patches = extractHtmlPatches(text);
      expect(patches).toHaveLength(1);
      expect(patches[0]?.search.trim()).toBe('<button>Enviar</button>');
      expect(patches[0]?.replace.trim()).toBe('<button class="primary">Enviar Ahora</button>');
    });

    it('extrae múltiples parches secuenciales en un mismo texto', () => {
      const text = `
<<<< SEARCH
<th>Nombre</th>
====
<th>Nombre Completo</th>
>>>>

<<<< SEARCH
<td>Activo</td>
====
<td><span class="badge">Vigente</span></td>
>>>>
`;
      const patches = extractHtmlPatches(text);
      expect(patches).toHaveLength(2);
      expect(patches[0]?.search.trim()).toBe('<th>Nombre</th>');
      expect(patches[1]?.search.trim()).toBe('<td>Activo</td>');
    });
  });

  describe('applyHtmlPatch', () => {
    const originalHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Mi Informe</title>
</head>
<body>
  <h1>Título Original</h1>
  <div class="card">
    <p>Texto original</p>
  </div>
</body>
</html>`;

    it('aplica coincidencia exacta de fragmento HTML', () => {
      const patches = [
        {
          search: '<h1>Título Original</h1>',
          replace: '<h1>Título Actualizado</h1>',
        },
      ];

      const result = applyHtmlPatch(originalHtml, patches);
      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);
      expect(result.html).toContain('<h1>Título Actualizado</h1>');
      expect(result.html).not.toContain('<h1>Título Original</h1>');
    });

    it('tolera diferencias de espacios e indentación en saltos de línea', () => {
      const patches = [
        {
          search: `  <div class="card">
    <p>Texto original</p>
  </div>`,
          replace: `  <div class="card bg-blue">
    <p>Texto modificado</p>
  </div>`,
        },
      ];

      const result = applyHtmlPatch(originalHtml, patches);
      expect(result.success).toBe(true);
      expect(result.html).toContain('Texto modificado');
      expect(result.html).toContain('bg-blue');
    });

    it('reporta error cuando el bloque SEARCH no existe en el documento', () => {
      const patches = [
        {
          search: '<table class="inexistente"></table>',
          replace: '<div>tabla</div>',
        },
      ];

      const result = applyHtmlPatch(originalHtml, patches);
      expect(result.success).toBe(false);
      expect(result.appliedCount).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.html).toBe(originalHtml);
    });
  });

  describe('versionado de artefactos', () => {
    it('crea el artefacto con versión inicial v1', () => {
      const artifact = createHtmlArtifact('art-1', 'msg-1', '<h1>Hola</h1>', 'Mi Reporte');
      expect(artifact.id).toBe('art-1');
      expect(artifact.currentVersion).toBe(1);
      expect(artifact.versions).toHaveLength(1);
      expect(artifact.versions[0]?.version).toBe(1);
      expect(artifact.versions[0]?.html).toBe('<h1>Hola</h1>');
    });

    it('agrega nuevas versiones y actualiza activeHtml', () => {
      const initial = createHtmlArtifact('art-1', 'msg-1', '<h1>v1</h1>');
      const v2 = addArtifactVersion(initial, '<h1>v2</h1>', 'user-edit', 'Cambio manual');

      expect(v2.currentVersion).toBe(2);
      expect(v2.activeHtml).toBe('<h1>v2</h1>');
      expect(v2.versions).toHaveLength(2);
      expect(v2.versions[1]?.summary).toBe('Cambio manual');
    });

    it('restaura una versión previa', () => {
      const initial = createHtmlArtifact('art-1', 'msg-1', '<h1>v1</h1>');
      const v2 = addArtifactVersion(initial, '<h1>v2</h1>', 'agent-patch');
      const v3 = addArtifactVersion(v2, '<h1>v3</h1>', 'agent-rewrite');

      const restored = restoreArtifactVersion(v3, 1);
      expect(restored.currentVersion).toBe(1);
      expect(restored.activeHtml).toBe('<h1>v1</h1>');
      expect(restored.versions).toHaveLength(3); // El historial completo se conserva
    });
  });

  describe('resolveMessageHtml', () => {
    it('detecta y aplica parche sobre HTML previo', () => {
      const prev = '<div class="card"><h1>Original</h1></div>';
      const text = `
Modificado:
\`\`\`html-patch
<<<< SEARCH
<h1>Original</h1>
====
<h1>Parcheado</h1>
>>>>
\`\`\`
`;
      const result = resolveMessageHtml(text, prev);
      expect(result.html).toBe('<div class="card"><h1>Parcheado</h1></div>');
      expect(result.isPatch).toBe(true);
      expect(result.patchCount).toBe(1);
    });

    it('detecta bloque HTML completo sin previo', () => {
      const text = '```html\n<h1>Completo</h1>\n```';
      const result = resolveMessageHtml(text);
      expect(result.html).toBe('<h1>Completo</h1>');
      expect(result.isPatch).toBe(false);
    });

    it('devuelve null si no hay HTML ni parches', () => {
      const text = 'Solo texto plano sin código';
      const result = resolveMessageHtml(text);
      expect(result.html).toBeNull();
    });
  });
});

