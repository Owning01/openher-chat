# Firebase (Hosting + Auth)

La app funciona **sin** Firebase (local-first). Firebase sólo se activa cuando el build
trae la configuración (`VITE_FIREBASE_*`); con ella aparece la pantalla de login.

## 1. Crear el proyecto y la app web

1. Entrá a la consola de Firebase y creá un proyecto (o usá uno existente).
2. **Agregá una app Web** (`</>`), ponele un nombre y copiá el bloque `firebaseConfig`.

## 2. Config local

Copiá `.env.example` a `.env.local` y completá:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<proyecto>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<proyecto>
VITE_FIREBASE_APP_ID=1:...:web:...
```

`.env.local` está gitignoreado. La config web de Firebase es **pública por diseño**
(no es un secreto: lo que protege los datos son las reglas del backend). Acá sólo se
usa Hosting + Auth, sin base de datos.

## 3. Habilitar los métodos de ingreso (en la consola)

- **Authentication → Sign-in method**:
  - habilitar **Correo electrónico/contraseña** (Email/Password);
  - habilitar **Google** (elegir un correo de soporte).
- **Authentication → Settings → Dominios autorizados**: `localhost` ya viene.
  Al desplegar en Hosting se agregan solos `<proyecto>.web.app` y `<proyecto>.firebaseapp.com`.
  Si usás un dominio propio, agregalo ahí (si falta, el error es `unauthorized-domain`).

## 4. Desplegar

```sh
npx --yes firebase-tools login
npx --yes firebase-tools use --add        # elegir el proyecto
pnpm build
npx --yes firebase-tools deploy --only hosting
```

Queda en `https://<proyecto>.web.app`. El `firebase.json` publica `dist/`, reescribe
todo a `index.html` y cachea los assets con hash.

## Límites conocidos (honestos)

- **Google en Android/iOS no funciona**: el WebView de Capacitor no puede completar el
  popup/redirect de Google. En el APK usá **correo y contraseña**. Para Google nativo hace
  falta `@capacitor-firebase/authentication` (plugin nativo, dependencia nueva).
- **Los datos siguen siendo locales**: Auth sólo autentica; conversaciones, ajustes y
  claves siguen en el dispositivo y **no se sincronizan**. Se separan por usuario
  (ver «Datos por usuario» abajo).
- **Sin sesión no se entra**: si configurás Firebase, la app pide login siempre.
- La sesión se recupera offline (Firebase guarda el estado en el dispositivo).

## Datos por usuario

Cada cuenta usa su propia **partición** del storage local, identificada por el UID
de Firebase. La app arranca en dos fases: primero sin usuario (portada/login,
tema e idioma globales) y, con sesión, migra lo legacy y rearranca los servicios
con `{ userId: uid }`, montando el árbol con `key={uid}` para no mezclar estados
entre cuentas.

### Qué se particiona

- **Ajustes** (`SettingsRepository`): cada usuario tiene los suyos.
- **API keys** (`KeyVault`): cada usuario guarda sus secretos por separado.
- **Conversaciones y mensajes** (IndexedDB).
- **Expedientes** (casos, documentos, análisis, acknowledgments y gaps).
- **Packs legales instalados**.

### Claves

- Legacy (sin usuario): `openher.settings.v1` y `openher.key.<ref>` en
  localStorage, más la base IndexedDB `openher-chat`.
- Con usuario (`uid`): `openher.settings.v1:<uid>`,
  `openher.key.<uid>:<ref>` y la base `openher-chat:<uid>` (el UID se sanea a
  `[A-Za-z0-9_-]`, máximo 64; si no queda nada usable se usa un hash).
- Un marcador en localStorage registra la migración ya hecha por UID, así la
  copia legacy→partición corre una sola vez.

### Migración única de lo legacy

Al primer inicio de sesión, `migrateLegacyStorageToOwner(uid)` copia los datos
legacy a la partición del usuario y **limpia el origen sólo tras verificar** la
copia. Si la migración falla, la app sigue igual con partición vacía/defaults y
lo reintenta en el próximo inicio de sesión.

### Al cerrar sesión

Se desmonta el árbol de la sesión (los stores se resetean por el `key={uid}`) y
se suelta la conexión IndexedDB del usuario (`closeOwnerDb`). Los datos quedan
**particionados en el dispositivo** (no se borran ni se suben a ningún servidor);
al volver a entrar, la cuenta recupera su partición.

### NOTA de seguridad (honesta)

Las particiones evitan que **la app** mezcle usuarios, pero localStorage e
IndexedDB son del **origen** del navegador/WebView (sin cifrado): quien tenga
acceso al dispositivo o al perfil del navegador puede leerlos con herramientas
de desarrollo. No es aislamiento a nivel de sistema operativo. Las API keys nunca
salen del dispositivo ni van a logs: sólo viajan en las llamadas directas al
proveedor configurado.
