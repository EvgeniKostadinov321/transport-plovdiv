# Deploy инструкции

## Production setup (текущо)

### Архитектура

- **Frontend:** Vercel (static React + PWA)
- **API:** Delta.bg VPS Sofia (Ubuntu 24.04, Basic C1-R1-D25)
- **SSL домейн:** `185-52-207-151.nip.io` (Let's Encrypt)

### Защо не Cloud functions (Vercel/Railway/CF Workers)

Общинският сайт `transport.plovdiv.bg` блокира datacenter IP диапазони (AWS, GCP, Cloudflare).
Доказано тествано — всичките дават TCP timeout.

Единствено BG residential / BG hosting ASN-и (Delta, SuperHosting, ICN и т.н.) минават.

### Production credentials

- **VPS IP:** `185.52.207.151`
- **VPS user:** `ubuntu`
- **API URL:** `https://185-52-207-151.nip.io`
- **Frontend URL:** `https://transport-plovdiv-mu.vercel.app`
- **GitHub:** `https://github.com/EvgeniKostadinov321/transport-plovdiv`

## Update flow (frequent operations)

### 1. Push code change

```bash
git add -A
git commit -m "..."
git push
```

Vercel auto-deploy-ва `web/` при всеки push.

### 2. Update API на VPS-а

```powershell
ssh -F NUL ubuntu@185.52.207.151
```

```bash
cd ~/transport-plovdiv
git pull
cd local-api
npm install            # ако има промени в package.json
sudo systemctl restart transport-api
sudo systemctl status transport-api    # provери че е "active (running)"
```

### 3. Vercel env vars

В Vercel Dashboard → Settings → Environment Variables:
- `VITE_API_URL` = `https://185-52-207-151.nip.io`
- `VITE_MAPTILER_KEY` = ...

При промяна → Deployments → Redeploy.

## Initial setup (one-time, направено)

### VPS provisioning

```bash
# Update OS
sudo apt update && sudo apt upgrade -y

# Node 22 + Git + Nginx + Certbot
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx

# Clone repo
git clone https://github.com/EvgeniKostadinov321/transport-plovdiv.git
cd transport-plovdiv/local-api
npm install
```

### Systemd service

`/etc/systemd/system/transport-api.service`:

```ini
[Unit]
Description=Transport Plovdiv API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/transport-plovdiv/local-api
ExecStart=/usr/bin/npx tsx server.ts
Restart=always
RestartSec=5
Environment=PORT=3001
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable transport-api
sudo systemctl start transport-api
```

### Nginx config

`/etc/nginx/sites-available/transport-api`:

```nginx
server {
    server_name 185-52-207-151.nip.io;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/185-52-207-151.nip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/185-52-207-151.nip.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = 185-52-207-151.nip.io) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name 185-52-207-151.nip.io;
    return 404;
}
```

> **Important:** CORS headers идват **САМО от Hono** в `server.ts`. НЕ дублирай в Nginx
> (browser се чупи на "multiple values").

```bash
sudo ln -s /etc/nginx/sites-available/transport-api /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### SSL (Let's Encrypt)

`nip.io` е стабилен wildcard DNS — `<IP-с-тирета>.nip.io` resolve-ва автоматично.
(DuckDNS не работи: Let's Encrypt получава DNS timeout при CAA queries.)

```bash
sudo certbot --nginx -d 185-52-207-151.nip.io
```

Auto-renewal се настройва автоматично (Certbot systemd timer).

## Troubleshooting

### API не отговаря

```bash
ssh -F NUL ubuntu@185.52.207.151
sudo systemctl status transport-api
sudo journalctl -u transport-api -f    # live логове
curl http://localhost:3001/health      # bypass nginx
curl https://185-52-207-151.nip.io/health  # с nginx
```

### Nginx config грешка

```bash
sudo nginx -t                          # валидация
sudo systemctl reload nginx            # reload
sudo journalctl -u nginx -n 50         # последни логове
```

### SSL cert проблем

```bash
sudo certbot renew --dry-run           # test renew
sudo certbot certificates              # list certs + expiry
```

### SSH issue (счупен ~/.ssh/config)

Винаги ползвай `-F NUL`:
```powershell
ssh -F NUL ubuntu@185.52.207.151
```

Или Delta web console: dashboard → server → "Console" / QEMU.

### Vercel build грешка

Локално:
```bash
cd web
npm run build
```

Ако работи локално но не на Vercel → виж Vercel build logs за specific грешка.

## Backup стратегия

- Code: GitHub (auto)
- Server config: тук в DEPLOY.md
- SSL certs: Let's Encrypt auto-renews
- Server data: няма state — всичко идва от transport.plovdiv.bg

При замяна на VPS-а:
1. Купи нов BG VPS (Delta или alt)
2. Repeat "Initial setup" по-горе
3. nip.io URL се променя на новия IP
4. Обнови `VITE_API_URL` в Vercel
