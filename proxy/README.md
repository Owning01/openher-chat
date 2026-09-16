# Proxy OpenCode en VPS (Go, sin dependencias)

La web de OpenHer Chat no puede llamar directo a `https://opencode.ai`
(el gateway no autoriza navegadores). Este binario reenvía todo tal cual
(incluido el streaming) y agrega el permiso CORS. La API key sigue en tu
dispositivo: viaja en tu propio header y solo se reenvía, nunca se guarda.

Flujo: **todo se cocina local, al VPS solo sube el binario listo + activar**.
Nada se compila ni comprime en el VPS. Los datos reales (IP, puerto SSH,
dominio) viven en `datostecnicos.md` (local, **nunca se commitea**).

## 1. DNS (una vez, en tu registrador)

Registro **A**: `<SUBDOMINIO>` → IP del VPS. Verificar:

```sh
dig +short <SUBDOMINIO>
```

## 2. Compilar + comprimir (local)

```sh
cd proxy
$env:GOOS="linux"; $env:GOARCH="amd64"
go build -ldflags="-s -w" -o <TMP>/openher-zen-proxy .
<UPX> --best --ultra-brute <TMP>/openher-zen-proxy
```

## 3. Subir y activar (único paso en el VPS)

```sh
scp -P <PUERTO> <TMP>/openher-zen-proxy <USER>@<VPS>:/root/openher-zen-proxy
ssh -p <PUERTO> <USER>@<VPS> "mv /root/openher-zen-proxy /usr/local/bin/openher-zen-proxy && chmod +x /usr/local/bin/openher-zen-proxy && systemctl restart openher-zen-proxy && curl -s http://127.0.0.1:8080/healthz"
# -> ok
```

Servicio systemd: `openher-zen-proxy.service`
(escucha solo en `127.0.0.1:8080`; ver `datostecnicos.md` para el usuario).

Seguridad: solo `GET`/`POST` al upstream fijo (no es un proxy abierto),
orígenes web restringidos por flag (`-allow-origins`), rate limit por IP en
nginx y TLS obligatorio (la app es HTTPS).

## 4. TLS (cuando el DNS resuelva, una vez)

```sh
ssh -p <PUERTO> <USER>@<VPS> "certbot --nginx -d <SUBDOMINIO> --non-interactive --agree-tos -m <MAIL> && curl -s https://<SUBDOMINIO>/zen/go/v1/models | head -c 60"
```

Sitio nginx: `sitio-nginx.conf` (reemplazar `<SUBDOMINIO>`; buffering off +
timeout 300s para SSE + `limit_req` 30r/m por IP).

## 5. En la app

Ajustes → Proxy → **Proxy OpenCode**: `https://<SUBDOMINIO>` →
Probar (conectado) → se guarda solo.
