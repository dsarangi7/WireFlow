# WireFlow on the AYK server

WireFlow runs on the company server behind the existing nginx. Engineers sign in with a WireFlow account and share every project, drawing, taught part and numbering. Developer: Dibya Jyoti Sarangi (Dibya).

| | |
| --- | --- |
| Address (office) | http://192.168.3.8:3002/wireflow/ |
| Address (worldwide) | http://113.74.25.42:3002/wireflow/ |
| Code | `C:\apps\WireFlow`, cloned from http://192.168.3.10:3000/Dibya/WireFlow.git |
| Data | `C:\WireFlowData` (outside git; never touched by updates) |
| Server | Node.js on 127.0.0.1:3005 (not reachable directly); nginx forwards `/wireflow/` to it |

The drawing work (reading the DXF, planning the cables, writing the PDF) still runs in each engineer's browser, exactly as before. The server only stores and hands out the data, so the tool feels as fast as before.

## What runs on the server

| Part | What it is |
| --- | --- |
| `server/server.js` | The web server: the site, sign-in and the data API. Plain Node.js; no `npm install`, no packages. |
| `C:\WireFlowData\wireflow.db` | Everything engineers make: accounts, projects, drawings (stored compressed), shared lists, and a log of who changed what. SQLite, built into Node. |
| `C:\WireFlowData\backups\` | Nightly copies of the database (the newest 30 are kept). |
| `C:\WireFlowData\server.log` | The server's output and errors. |
| Task **AYK_WireFlow** | Starts the server at boot and restarts it if it stops. Runs as SYSTEM. |
| Task **AYK_WireFlow_Backup** | Copies the database every night at 02:00. |
| nginx `location /wireflow/` | In `C:\nginx\nginx-1.30.3\conf\nginx.conf`; the block is in `deploy/nginx-wireflow.conf`. |

A rack drawing takes about 3 MB once compressed, and WireFlow uses well under 1 GB of RAM.

## First installation

1. Install **Node.js LTS** (22.13 or newer) from https://nodejs.org.
2. Clone the code:

   ```powershell
   git clone http://192.168.3.10:3000/Dibya/WireFlow.git C:\apps\WireFlow
   ```

3. In PowerShell opened as administrator, run:

   ```powershell
   cd C:\apps\WireFlow; .\server\install-windows.ps1
   ```

   This registers both tasks and starts WireFlow on 127.0.0.1:3005. If port 3005 is taken, use `-Port <free port>` and change the nginx block to match.
4. Create the admin account. You are asked for the password, which is never shown:

   ```powershell
   $env:WIREFLOW_DATA = 'C:\WireFlowData'; node server\server.js adduser dibya "Dibya Jyoti Sarangi" --admin
   ```

5. Add the block from `deploy/nginx-wireflow.conf` inside the `server { listen 3002; ... }` block, before `location / { ... }`. Back up `nginx.conf` first, run `nginx -t`, then `nginx -s reload`.
6. Open http://192.168.3.8:3002/wireflow/ and sign in. Under your name (top right), add each engineer.

## Updating WireFlow

1. On the development PC: run the tests, commit, then push to Gitea.
2. On the server:

   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\apps\WireFlow\deploy\Update-WireFlow.ps1
   ```

   This pulls the code, and restarts AYK_WireFlow if the server code changed. Engineers stay signed in. Browsers check for new files on every load, so a reload is enough and nobody needs Ctrl+Shift+R. nginx does not need a reload.

Database tables are created with `CREATE TABLE IF NOT EXISTS`. A future change that needs a new column must add it with `ALTER TABLE` in `server.js`.

## Tests

On the development PC, before every push (Node.js only):

```powershell
Get-ChildItem tests\*.test.js | ForEach-Object { node $_.FullName }
```

`tests/server.test.js` starts the server with a temporary database. It checks sign-in, accounts, shared projects, the conflict check, shared lists, compression, the nginx sub-path and that private files are never served.

## Accounts and safety

- Passwords are stored only as scrypt hashes. Sessions last 12 hours of inactivity, in an HttpOnly cookie limited to `/wireflow/`.
- After 10 failed sign-ins from one PC, sign-in is blocked for 15 minutes. Behind nginx, each engineer's own address is used, so one PC's failures never block the others.
- The admin can add engineers, set a new password, and lock or unlock an account. Locking signs that person out at once. Accounts are never deleted, so the log of who changed what stays complete.
- **Two engineers on one rack:** if engineer B saves a rack that engineer A changed after B opened it, B's save is refused. B sees who changed it and is asked to reload, so nobody's work is overwritten silently.
- Only the site files are served. The database, the server code, the tests, `.git` and the confidential `Electrical Diagram` folder are never served.
- **Worldwide address on plain HTTP:** passwords and drawings cross the internet unencrypted. Use strong passwords. HTTPS on nginx (a certificate for the public address) would fix this. Until then, an option is to give the worldwide address only to engineers who need it.

## Backups and restore

- `C:\WireFlowData\backups` holds a copy for each of the last 30 nights; copy that folder to another machine or a NAS too.
- A backup can be taken at any time, while WireFlow runs:

  ```powershell
  cd C:\apps\WireFlow; $env:WIREFLOW_DATA = 'C:\WireFlowData'; node server\server.js backup
  ```

- **To restore:**
  1. Run `Stop-ScheduledTask AYK_WireFlow`.
  2. Copy the backup over `C:\WireFlowData\wireflow.db`.
  3. Delete `wireflow.db-wal` and `wireflow.db-shm`.
  4. Run `Start-ScheduledTask AYK_WireFlow`.

## Projects made before the server

When an engineer signs in on a PC that already has projects in its browser, the Diagrams page offers **Copy to the server**.

- Racks, electrical diagrams, drawings, taught parts and numberings are copied.
- A project number already on the server is merged into that project.
- The links between racks are renumbered.
- The browser keeps its own copy.

## Other commands

Run these in `C:\apps\WireFlow`, after `$env:WIREFLOW_DATA = 'C:\WireFlowData'`:

| Command | Does |
| --- | --- |
| `node server\server.js users` | Lists the accounts |
| `node server\server.js passwd <user>` | Sets a new password |
| `node server\server.js adduser <user> "<Full name>" [--admin]` | Adds an account |
| `node server\server.js backup [folder]` | Copies the database now |

The public copy on GitHub Pages keeps working without a server; there, projects stay in the browser.
