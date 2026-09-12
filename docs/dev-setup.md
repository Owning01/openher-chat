# Dev Setup — OpenHer Chat

## Requisitos

| Herramienta | Versión |
| --- | --- |
| Node.js | ≥ 22.12 (probado con 24.19.0) |
| pnpm | ≥ 10 (probado con 12.3.4) |
| JDK 21 + Android Studio | solo para compilar el APK (`assembleDebug`/Android Studio); `cap sync` no los requiere |

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
| `pnpm android:sync` | Copia `dist/` al proyecto Android y sincroniza plugins (`cap sync android`) |
| `pnpm android:open` | Abre el proyecto Android en Android Studio (`cap open android`) |

Nota: `tsc --noEmit` en la raíz es vacuo porque el tsconfig solo declara `references`; el type-check real de `src/` y de las configs corre siempre con `pnpm exec tsc -b` (también incluido en `pnpm build`).

## Estructura

- `src/main.tsx` monta `src/app/App.tsx` en `#root`.
- `src/styles/index.css` contiene Tailwind CSS 4 con tokens base claro/oscuro (clase `.dark`).
- Alias `@/` → `src/` (definido en `vite.config.ts` y `tsconfig.app.json`).

## Android (Capacitor)

La configuración vive en `capacitor.config.ts` (`appId: app.openher.chat`, `webDir: dist`, `androidScheme: https`). El proyecto nativo ya está generado en `android/`:

```sh
pnpm build
pnpm android:sync        # npx cap sync android (copia dist/ y sincroniza plugins)
pnpm android:open        # npx cap open android (requiere Android Studio + JDK 21)
```

`cap add`/`cap sync` no necesitan SDK; solo `assembleDebug` o Android Studio requieren JDK 21 + SDK. La carpeta `android/` se versiona; su `.gitignore` interno (generado por Capacitor) excluye artefactos de build (`.gradle/`, `build/`, `local.properties`).

Nota: el proyecto nativo conserva los iconos/splash por defecto del template de Capacitor en `android/app/src/main/res/` (`android/**` solo se regenera vía comandos `cap`). Reemplazarlos por los assets propios requiere `npx @capacitor/assets` y una fuente PNG/SVG en `assets/`, fuera del alcance y de las dependencias aprobadas de esta tarea. La PWA sí usa el icono propio en `public/icons/icon.svg`.

## PWA (web de producción)

El build web incluye `public/manifest.webmanifest`, `public/icons/icon.svg` y `public/sw.js`. El service worker se registra solo en producción y fuera de Capacitor (`src/main.tsx`); cachea el shell y usa network-first para navegación. Para probarlo: `pnpm build`, `pnpm preview` y abrir la URL servida.
