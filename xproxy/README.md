# Proxy X (Twitter) en VPS — estado y activación

Binario Go mínimo (solo stdlib) que expone lectura de X sobre `twitter-cli`.
Desplegado en el VPS como `openher-x-proxy` (127.0.0.1:8081) detrás de
nginx en `https://<SUBDOMINIO>/x-api/` con rate limit propio.

Endpoints:
- `GET /healthz`
- `GET /x/user-posts?user=<screenName>&count=<1..20>`
- `GET /x/user?user=<screenName>`
- `GET /x/feed?count=<1..20>`
- `POST /x/search` (best-effort: el buscador de X puede devolver 404 según su API)

## Falta un paso (solo el dueño)

El CLI necesita la sesión de X del dueño. En el VPS no hay navegador, así
que se configuran las cookies como variables de entorno del servicio:

1. En la PC, con Chrome logueado en x.com: DevTools → Application → Cookies
   → `https://x.com` → copiar los valores de `auth_token` y `ct0`.
2. En el VPS, crear el override del servicio:
   ```sh
   sudo systemctl edit openher-x-proxy
   ```
   y pegar (una sola vez):
   ```ini
   [Service]
   Environment=TWITTER_AUTH_TOKEN=<pegar_auth_token>
   Environment=TWITTER_CT0=<pegar_ct0>
   ```
3. `sudo systemctl restart openher-x-proxy` y verificar:
   ```sh
   curl -s "https://<SUBDOMINIO>/x-api/x/user-posts?user=elonmusk&count=2" | head -c 200
   ```

Nota de seguridad: las cookies son equivalentes a la sesión de la cuenta.
Quedan solo en el VPS (root, override de systemd) y nunca se commitean ni
viajan en la app. Si se revocan (cerrar sesión en x.com), hay que repetir.

## Rebuild del binario (local → VPS)

```sh
cd xproxy
$env:GOOS="linux"; $env:GOARCH="amd64"
go build -ldflags="-s -w" -o G:\tmp\openher-x-proxy .
G:\tmp\upx\upx-5.0.2-win64\upx.exe --best --ultra-brute G:\tmp\openher-x-proxy
scp -P <PUERTO> G:\tmp\openher-x-proxy <USER>@<VPS>:/root/openher-x-proxy
ssh -p <PUERTO> <USER>@<VPS> "mv /root/openher-x-proxy /usr/local/bin/ && systemctl restart openher-x-proxy"
```
