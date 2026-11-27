# WireFlow on the AYK server

WireFlow runs on the company server at **http://192.168.3.8**. Engineers sign in with a WireFlow account and share every project, drawing, taught part and numbering. Developer: Dibya Jyoti Sarangi (Dibya).

The drawing work (reading the DXF, planning the cables, writing the PDF) still runs in each engineer's browser, exactly as before. The server only stores and hands out the data, so the tool feels as fast as before.

## What runs on the server

| Part | What it is |
| --- | --- |
| `server/server.js` | The web server: the site, sign-in and the data API. Plain Node.js; no `npm install`, no packages. |
| `C:\WireFlowData\wireflow.db` | Everything engineers make: accounts, projects, drawings (stored compressed), shared lists, and a log of who changed what. SQLite, built into Node. |
| `C:\WireFlowData\backups\` | Nightly copies of the database (the newest 30 are kept). |
| `C:\WireFlowData\server.log` | The server's output and errors. |
| Task **WireFlow Server** | Starts the server at boot and restarts it if it stops. Runs as SYSTEM. |
| Task **WireFlow Backup** | Copies the database every night at 02:00. |

Server: Windows Server 2025, 8 cores, 16 GB RAM, 650 GB disk. WireFlow uses well under 1 GB of RAM. A rack drawing takes about 3 MB of disk once compressed.

## First installation

1. Install **Node.js LTS** (22.13 or newer) from https://nodejs.org with the Windows installer.
2. Install **Git for Windows**, and clone the WireFlow repository from the company Gitea, for example to `C:\WireFlow`.
3. Open PowerShell with **Run as administrator**, go to that folder, and run:

   ```powershell
   .\server\install-windows.ps1
   ```

   This registers both tasks, opens port 80 in Windows Firewall (domain and private networks) and starts the server. If IIS or another web server already uses port 80, stop it or use `-Port 8080`; the address then becomes http://192.168.3.8:8080.
4. Create the admin account. You are asked for the password, and it is never shown or saved in plain text:

   ```powershell
   $env:WIREFLOW_DATA = 'C:\WireFlowData'; node server\server.js adduser dibya "Dibya Jyoti Sarangi" --admin
   ```

5. Open http://192.168.3.8 and sign in. Under your name (top right), add each engineer with a username and a first password; they can change it after signing in.

## Updating WireFlow

There is no build step: the files in git are the site.

1. On the development PC: make the change and run the tests (below). Commit, then push to the company Gitea.
2. On the server, in `C:\WireFlow`:

   ```powershell
   git pull
   ```

3. Changes to the app only (`js/`, `index.html`, `*.css`, `assets/`) are live at once. Browsers check for new files on every load, so engineers just reload the page, and nobody needs Ctrl+Shift+R.
4. If `server/server.js` changed, restart the server (signed-in engineers stay signed in):

   ```powershell
   Stop-ScheduledTask 'WireFlow Server'; Start-ScheduledTask 'WireFlow Server'
   ```

Database tables are created with `CREATE TABLE IF NOT EXISTS`. A future change that needs a new column must add it with `ALTER TABLE` in `server.js`.

## Tests

Run these on the development PC before every push. They need Node.js only.

```powershell
Get-ChildItem tests\*.test.js | ForEach-Object { node $_.FullName }
```

`tests/server.test.js` starts the server with a temporary database. It checks sign-in, accounts, shared projects, the conflict check, shared lists, compression and that private files are never served.

## Accounts and safety

- Passwords are stored only as scrypt hashes. Sessions last 12 hours of inactivity, in an HttpOnly cookie.
- After 10 failed sign-ins from one PC, sign-in is blocked for 15 minutes.
- The admin can add engineers, set a new password, and lock or unlock an account. Locking signs that person out at once.
- Accounts are never deleted, so the log of who changed what stays complete.
- Every save records the engineer, and project cards show "Updated … by …".
- **Two engineers on one rack:** if engineer B saves a rack that engineer A changed after B opened it, B's save is refused. B sees who changed it and is asked to reload, so nobody's work is overwritten silently.
- The server serves only the site files. The database, the server code, the tests, `.git` and the confidential `Electrical Diagram` folder are never served.
- **HTTP or HTTPS:** on plain HTTP, passwords cross the office network unencrypted. If the company has its own certificate authority, issue a certificate for the server as a `.pfx` file, then set `WIREFLOW_PFX` (its path) and `WIREFLOW_PFX_PASS` in the two tasks. The address then becomes https://192.168.3.8.

## Backups and restore

- `C:\WireFlowData\backups` holds a copy for each of the last 30 nights. Copy that folder to another machine or a NAS too (see `-BackupDir` in the install script).
- A backup can be taken at any time, while the server runs:

  ```powershell
  $env:WIREFLOW_DATA = 'C:\WireFlowData'; node server\server.js backup
  ```

- **To restore:**
  1. Stop the task.
  2. Copy the chosen backup over `C:\WireFlowData\wireflow.db`.
  3. Delete `wireflow.db-wal` and `wireflow.db-shm`.
  4. Start the task.

## Projects made before the server

When an engineer signs in on a PC that already has projects in its browser, the Diagrams page offers **Copy to the server**.

- Racks, electrical diagrams, drawings, taught parts and numberings are copied.
- A project number already on the server is merged into that project.
- The links between racks (strings across racks, several racks on one sheet) are renumbered.
- The browser keeps its own copy.

## Other commands

| Command (in `C:\WireFlow`, with `$env:WIREFLOW_DATA = 'C:\WireFlowData'`) | Does |
| --- | --- |
| `node server\server.js users` | Lists the accounts |
| `node server\server.js passwd <user>` | Sets a new password, for example if the admin forgets theirs |
| `node server\server.js adduser <user> "<Full name>" [--admin]` | Adds an account |
| `node server\server.js backup [folder]` | Copies the database now |

The public copy on GitHub Pages keeps working without a server. There, projects stay in the browser as before.
