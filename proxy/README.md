# Proxy OpenCode en tu VPS (Go, sin dependencias)

La web de OpenHer Chat no puede llamar directo a `https://opencode.ai`
(el gateway no autoriza navegadores). Este binario reenvía todo tal cual
(incluido el streaming) y agrega el permiso CORS. La API key sigue en tu
dispositivo: viaja en tu propio header y solo se reenvía, nunca se guarda.

## 1. DNS (en tu proveedor del dominio progavio)

Crear un registro **A**: `zen` → IP pública del VPS. Esperar que resuelva:

```sh
dig +short zen.tu-dominio
```

## 2. Compilar (en el VPS, Ubuntu con Go)

```sh
cd proxy
go build -o openher-zen-proxy .
sudo install -m 0755 openher-zen-proxy /usr/local/bin/openher-zen-proxy
```

## 3. Servicio (systemd)

```sh
sudo install -m 0644 openher-zen-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openher-zen-proxy
systemctl is-active openher-zen-proxy
curl -s http://127.0.0.1:8080/healthz  # -> ok
```

## 4. HTTPS con Caddy (HTTPS obligatorio: la app es HTTPS)

```sh
sudo apt install -y caddy
sudo PROXY_DOMAIN=zen.tu-dominio caddy fmt --overwrite Caddyfile
sudo install -m 0644 Caddyfile /etc/caddy/Caddyfile
# Editar /etc/caddy/Caddyfile: reemplazar {$PROXY_DOMAIN} por zen.tu-dominio
sudo systemctl reload caddy
```

## 5. Probar

```sh
curl -s https://zen.tu-dominio/zen/go/v1/models | head -c 120
# -> {"object":"list","data":[...]}
```

## 6. En la app

Ajustes → Proxy → **Proxy OpenCode**: `https://zen.tu-dominio` → Probar
(conectado) → Guardar. La API key se configura igual que siempre, en el
proveedor OpenCode.
