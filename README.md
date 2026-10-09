# Defense of Hogwarts — local HTTPS event setup

This app runs only on the laptop and its USB-tethered phone network. The phone Controller must use HTTPS so Chrome can request camera access. Camera frames remain on the phone; it sends only normalized laser coordinates over the secure WebSocket connection.

## Prerequisites (Windows)

- Node.js 18+ and npm: verify with `node -v` and `npm -v`.
- Chrome on the phone and laptop.
- [mkcert](https://github.com/FiloSottile/mkcert). Verify with `mkcert -version`.
- USB cable/tethering enabled on the phone.

Install mkcert if it is absent. With Chocolatey: `choco install mkcert`; with Scoop: `scoop install mkcert`; or download the Windows binary from the mkcert release page and put it on `PATH`.

## First-time certificate setup

1. Install the local mkcert Certificate Authority on the laptop:

   ```powershell
   mkcert -install
   mkcert -CAROOT
   ```

   The second command prints the CA directory. It contains `rootCA.pem` and the secret `rootCA-key.pem`.

2. The central USB address is in [config/network.js](C:\Users\Nelson\Documents\New project\config\network.js). The current value is `10.42.67.43`. Create the local certificate directory and issue a certificate for that exact IP:

   ```powershell
   New-Item -ItemType Directory -Force certs
   mkcert -cert-file certs/laser-fruit-slash.pem -key-file certs/laser-fruit-slash-key.pem localhost 127.0.0.1 ::1 10.42.67.43
   ```

   Certificate files are deliberately ignored by Git. Never share or commit `laser-fruit-slash-key.pem` or `rootCA-key.pem`.

3. Install app packages and start the HTTPS server:

   ```powershell
   npm install
   npm start
   ```

   If certificates are missing, startup intentionally stops with an explicit setup error; it never falls back to insecure HTTP.

## Trust the certificate on Android

1. Run `mkcert -CAROOT`, then copy **only** `rootCA.pem` from that folder to the Android phone (USB file transfer is fine).
2. On Android, open Settings and search for **Install certificate** / **Install from device storage**. Choose **CA certificate**, select `rootCA.pem`, and confirm the warning using the device PIN. Menu names vary by Android version/vendor.
3. Do **not** copy `rootCA-key.pem`; it is the private CA key.
4. Return to Chrome after installation. If Chrome had been open before CA installation, fully close/reopen it. Device-managed phones may disallow user CA installation; use an unmanaged event phone or ask its administrator.

## USB tethering and URLs

1. Connect the phone to the laptop by USB, enable **USB tethering**, and mount it in landscape orientation.
2. On Windows run `ipconfig`. Find the IPv4 address of the USB tethering/Ethernet adapter. It should currently be `10.42.67.43`.
3. Open these HTTPS URLs:

   - Game: `https://10.42.67.43:3000/game/`
   - **Phone Controller:** `https://10.42.67.43:3000/controller/`
   - Admin: `https://10.42.67.43:3000/admin/`
   - Leaderboard: `https://10.42.67.43:3000/leaderboard/`

   On the laptop, `https://localhost:3000/` also works. The browser clients derive the secure `wss://` endpoint from their current page origin, so no controller-side IP configuration is needed.

4. On the phone Controller page, grant Chrome camera permission and tap **Enable Camera**. Keep the phone in landscape orientation. Calibrate TL/TR/BR/BL around the smartboard, save corners, test the red pointer, then start a round from Admin.

## Controller calibration

- The saved four-corner border is used for laser detection and perspective coordinate mapping, and persists in `data/leaderboard.json`.
- Every corner is constrained inside the viewport so it remains reachable.
- If a border is wrong or partly off-screen, tap **Reset Border**. It immediately replaces both the displayed and saved calibration with a safe inset rectangle, then opens calibration mode again. Drag the corners and tap **Save corners** when finished.
- Reset Border does not change camera zoom; no browser or camera zoom controls are used.

## Running a round

1. Open Admin, confirm **Controller connected**, choose Easy/Medium/Hard and a 120/150/180-second duration.
2. Select **Start Game**. The Game display shows `3`, `2`, `1`, then `SLASH!` before active gameplay starts.
3. During a round, Admin can pause, resume, or end the round; difficulty, duration, and calibration remain locked.
4. At game over, submit the player's name. Scores are retained locally in `data/leaderboard.json`; the public Leaderboard shows the live Top 10.

## Leaderboard delete PIN

The deletion PIN is required only for deleting an individual record or clearing all leaderboard records. The current default PIN is:

```text
274913
```

It is server-side only: [server.js](C:\Users\Nelson\Documents\New project\server.js) uses `ADMIN_PIN`, falling back to `274913` when no environment value is set. The Admin page never receives the PIN in normal state data; it only sends the operator-entered value to the server for destructive-operation validation.

Change it before an event by setting an environment variable in the PowerShell session that starts the app:

```powershell
$env:ADMIN_PIN="your-new-six-digit-pin"
npm start
```

Keep the value private. To reset all stored score/calibration data manually while the server is stopped, back up `data/leaderboard.json` and replace its contents with `{"leaderboard":[],"highScore":0,"calibration":null}`. Prefer the Admin clear action for leaderboard-only deletion because it requires the PIN.

## If the USB IP changes

Certificates are valid only for their listed names/IPs. If `ipconfig` now reports, for example, `10.42.67.44`:

1. Update the single `HOST_IP` value in [config/network.js](C:\Users\Nelson\Documents\New project\config\network.js) to `10.42.67.44`.
2. Regenerate both files (overwriting the old certificate is expected):

   ```powershell
   mkcert -cert-file certs/laser-fruit-slash.pem -key-file certs/laser-fruit-slash-key.pem localhost 127.0.0.1 ::1 10.42.67.44
   ```

3. Restart `npm start` and open `https://10.42.67.44:3000/controller/` on the phone.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `mkcert` command not found | Install it, reopen PowerShell, and run `mkcert -version`. |
| HTTPS certificates not found | Run the certificate-generation command above; confirm both files exist under `certs/`. |
| `NET::ERR_CERT_AUTHORITY_INVALID` | Install `rootCA.pem` as an Android **CA certificate**, then restart Chrome. Never install or transfer the CA key. |
| Certificate not valid for this IP | Compare `ipconfig` with `HOST_IP`, update it, regenerate the certificate, and restart the server. |
| Camera permission does not appear / secure origins error | Confirm the phone is on `https://`, the certificate is trusted, then check Chrome site settings for Camera and reload. Do not use Chrome flags. |
| Phone cannot open the HTTPS URL | Confirm USB tethering, compare `ipconfig`, ensure `npm start` is running, and test the URL from the laptop. |
| WebSocket/controller disconnected | Reload the Controller URL over HTTPS. The app automatically uses `wss://` when page protocol is HTTPS; check that no proxy/security product is blocking port 3000. |
| Windows Firewall blocks the phone | In Windows Defender Firewall → Allow an app, allow Node.js on **Private** networks; alternatively create a narrowly scoped inbound TCP rule for port 3000 on the Private tethered profile. Do not disable the firewall. |
| Port already in use | Run `Get-NetTCPConnection -LocalPort 3000`, stop the owning test process, or set `HTTPS_PORT` before startup and use that port in every URL. |
| Camera feed appears but tracking fails | Recalibrate so the board is entirely inside the quadrilateral; tune centralized constants in `public/controller/tracker.js`, reduce red reflections, and test the pointer. |

## Event test checklist

- [ ] `npm start` reports the HTTPS address and loads the certificate.
- [ ] Game, Admin, and Leaderboard load on the laptop.
- [ ] Phone opens the HTTPS Controller address without a certificate warning.
- [ ] Chrome camera permission appears; feed, calibration, and laser marker work.
- [ ] Controller reports connected and Admin sees it.
- [ ] Laser movement, fruit/bomb collisions, scoring, and live leaderboard work.
