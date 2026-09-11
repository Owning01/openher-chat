# Dev Setup — OpenHer Chat

## Requisitos

| Herramienta | Versión |
| --- | --- |
| Node.js | ≥ 22.12 (probado con 24.19.0) |
| pnpm | ≥ 10 (probado con 12.3.4) |
| JDK 21 + Android Studio | solo para T16 (packaging Android), no requerido todavía |

No hay backend ni servicios externos: la app es una SPA que corre 100% local (IndexedDB + localStorage).

## Instalación

```sh
pnpm install
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Vite dev server con HMR |
| `pnpm test` | Vitest en modo run (entorno jsdom, setup en `src/test/setup.ts`) |
| `pnpm test:watch` | Vitest en modo watch |
| `pnpm exec tsc -b` | Type-check oficial del workspace (proyecto app + configs vía `references`) |
| `pnpm build` | Type-check completo (`tsc -b`) + build de producción hacia `dist/` |
| `pnpm preview` | Sirve `dist/` localmente |

Nota: `tsc --noEmit` en la raíz es vacuo porque el tsconfig solo declara `references`; el type-check real de `src/` y de las configs corre siempre con `pnpm exec tsc -b` (también incluido en `pnpm build`).

## Estructura

- `src/main.tsx` monta `src/app/App.tsx` en `#root`.
- `src/styles/index.css` contiene Tailwind CSS 4 con tokens base claro/oscuro (clase `.dark`).
- Alias `@/` → `src/` (definido en `vite.config.ts` y `tsconfig.app.json`).

## Android (T16, todavía no habilitado)

La configuración base ya está en `capacitor.config.ts` (`appId: app.openher.chat`, `webDir: dist`, `androidScheme: https`). Cuando el MVP esté cerrado:

```sh
pnpm build
pnpm exec cap add android    # crea la carpeta android/ (proyecto Gradle)
pnpm exec cap sync android
pnpm exec cap open android   # abre Android Studio
```

La carpeta `android/` se versiona; su `.gitignore` interno (generado por Capacitor) excluye artefactos de build (`.gradle/`, `build/`, `local.properties`).
