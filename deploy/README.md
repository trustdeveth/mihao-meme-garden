# Windows VPS deployment

Live URLs: https://mihaomeme.garden and https://www.mihaomeme.garden.

Runs directly on Windows VPS 170.205.30.90. Scheduled task `MihaoMemeGarden`
runs `deploy/start-windows.ps1` as SYSTEM at boot, restarts on failure, and a
one-minute repeating trigger restarts a stopped process (IgnoreNew prevents
duplicates). Node serves the API, WebSocket and `client/dist` on 127.0.0.1:8892.

Configuration: root `.env` (private, gitignored): `NODE_ENV`, `HOST`, `PORT`,
`MG_SECRET`, `MG_ORIGINS`. Keep `MG_SECRET` unchanged between updates or all
player sessions are invalidated.

Shared Caddy config `C:/caddy/Caddyfile` proxies both hostnames, handles TLS
certificates, redirects HTTP to HTTPS and upgrades WebSockets.
Pre-deployment backup: `C:/caddy/Caddyfile.bak-mihao-20261124-235707`.

Database: `server/data/meme-garden.db` (+ WAL files). Logs: `server/data/logs/`.
Preserve `server/data` on updates.

## Update

From elevated PowerShell in the project directory:

```powershell
git pull
npm ci
npm run build
npm run test:shared; npm run test:server
Stop-ScheduledTask -TaskName MihaoMemeGarden
Start-ScheduledTask -TaskName MihaoMemeGarden
Invoke-RestMethod http://127.0.0.1:8892/api/health
```

Weekly challenge moderation runs here too: `npm run challenge -- list`.
