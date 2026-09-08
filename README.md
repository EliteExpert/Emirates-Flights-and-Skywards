# Emirates PTFS FIDS

An Express flight board for Emirates PTFS, with a public departures/arrivals display and a protected API for BotGhost updates.

## Local preview

```powershell
npm install
npm start
```

Open `http://localhost:3000`. Until Supabase is configured, the board uses `public/flights.json` sample data.

## Deploy to Render

1. Create a GitHub repository and push this folder.
2. In Render, select **New → Blueprint** and connect the repository. Render reads `render.yaml`.
3. Create a Supabase project. In the Supabase SQL Editor, run `supabase/schema.sql`.
4. In Render's environment settings, add `FIDS_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` from your Supabase project. Do not expose the service role key in browser code or BotGhost.
5. Deploy. The `/health` route reports whether Supabase is connected.

Flights dated before the current GMT date are permanently removed from Supabase automatically. Enter all BotGhost flight dates and times in GMT.

## BotGhost commands

Create staff-only BotGhost custom commands. In each, use **Send an API Request** and add the header `X-FIDS-Key` with the same value as Render's `FIDS_API_KEY`.

### Add or replace a flight

`POST https://YOUR-RENDER-URL/api/flights`

```json
{
  "type": "departure",
  "date": "2026-07-28",
  "flightNumber": "EK247",
  "airline": "Emirates PTFS",
  "departureTime": "19:30",
  "destination": "London Heathrow (LHR)",
  "aircraft": "A350-900",
  "terminal": "T3",
  "status": "Boarding",
  "discordEvent": "https://discord.com/events/SERVER_ID/EVENT_ID"
}
```

For an arrival, use `"type": "arrival"` and replace `departureTime` with `arrivalTime`. The same flight type, date, and flight number updates the existing record.

### Change a status

`POST https://YOUR-RENDER-URL/api/flights/status`

```json
{
  "type": "departure",
  "date": "2026-07-28",
  "flightNumber": "EK247",
  "status": "Final Call"
}
```

### Remove a flight

`POST https://YOUR-RENDER-URL/api/flights/remove`

```json
{
  "type": "departure",
  "date": "2026-07-28",
  "flightNumber": "EK247"
}
```

### Weekly Discord schedule

Create a BotGhost scheduled command for **Sunday, 00:00 GMT**. Add a **Send an API Request** action named `weekly`:

- Method: `GET`
- URL: `https://YOUR-RENDER-URL/api/flights/weekly-summary`
- Header: `X-FIDS-Key` with your `FIDS_API_KEY`

Then attach a **Send or Edit a Message** action to that request, choose your announcement channel, and set its content to:

```text
{weekly.response.message}
```

The endpoint reads this Sunday through Saturday from Supabase, formats a GMT weekly schedule, and links members to the full live board. It abbreviates only the Discord post if it would exceed Discord's message limit; every flight remains available on the board.

Use only the listed statuses: `Check-in Open`, `Boarding`, `Final Call`, `Gate Closed`, `Delayed`, `Cancelled`, `Departed`, `In Flight`, and `Arrived`.

### BotGhost JSON values

When using BotGhost options, keep every text option inside double quotes. For example:

```json
{
  "type": "{option_type}",
  "date": "{option_date}",
  "flightNumber": "{option_flightnumber}",
  "status": "{option_status}"
}
```

Without the quotes, BotGhost turns an arrival option into `"type":arrival`, which is invalid JSON.

## Native Discord.js bot

The project now includes a native Discord.js v14 bot (currently pinned to the v14 line with `^14.27.0`). The bot never writes to Supabase directly: `/add-flight` sends the completed flight to the existing `POST /api/flights` endpoint with the existing `X-FIDS-Key` authentication, so the website and Discord use the same validation and database path.

### Discord Developer Portal setup

1. Open the Discord Developer Portal and create an application.
2. On **General Information**, copy the **Application ID** into `DISCORD_CLIENT_ID`.
3. On **Bot**, create/reset the bot token and put it in `DISCORD_TOKEN`. Never commit this value.
4. Invite the bot to the server using OAuth2 with the `bot` and `applications.commands` scopes.
5. The bot needs permission to **View Channel**, **Send Messages**, **Embed Links**, and **Use Application Commands** in the weekly flight channel. It does not require privileged Gateway intents; the bot uses only the `Guilds` intent.
6. `/weekly-flight` is restricted to users with **Manage Server** and to `WEEKLY_FLIGHT_CHANNEL_ID`.

### Environment variables

Required for the native bot:

- `DISCORD_TOKEN` — Discord bot token.
- `DISCORD_CLIENT_ID` — Discord application/client ID.
- `WEEKLY_FLIGHT_CHANNEL_ID` — channel ID for the weekly submission announcement.
- `FIDS_API_KEY` — the same secret accepted by the existing FIDS API.

Optional:

- `DISCORD_GUILD_ID` — server/guild ID. When present, slash commands are registered as guild commands for fast development. Without it, commands are registered globally.
- `FIDS_BASE_URL` — FIDS HTTP base URL. Defaults to `http://127.0.0.1:3000`.

Existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` remain unchanged and are used only by the Express server.

### Finding Discord IDs

Enable **Developer Mode** in Discord under **User Settings → Advanced**. Then right-click the server and choose **Copy Server ID** for `DISCORD_GUILD_ID`, and right-click the target weekly channel and choose **Copy Channel ID** for `WEEKLY_FLIGHT_CHANNEL_ID`.

### Local development

Install dependencies:

```bash
npm install
```

Start the FIDS server:

```bash
npm start
```

In a second terminal, start the bot:

```bash
node bot/index.js
```

For this two-process setup, keep `DISCORD_TOKEN` out of the environment used by the FIDS server to avoid starting a second bot instance from `server.js`. If `DISCORD_TOKEN` is present when `server.js` starts, the Express process also starts the bot automatically for combined deployment.

### `/add-flight` workflow

`/add-flight` creates a temporary, per-user session stored in memory. The user chooses Departure or Arrival, enters a validated `YYYY-MM-DD` date, chooses an airline (or enters another airline), selects one of the database-supported statuses, and enters the flight number, GMT time, destination/origin, aircraft and terminal.

Sessions expire after approximately 10 minutes and are keyed by Discord user ID. A session cannot be continued by another user. The final submission is sent to `POST /api/flights` using `X-FIDS-Key`; no Discord code accesses Supabase.

The bot sends `discordEvent: ""` for initial submissions. The existing API accepts this empty value while continuing to validate a non-empty Discord event URL as HTTPS. This preserves the existing database column and API contract without inventing a fake event URL.

### Weekly scheduler

The native scheduler explicitly works in UTC. It calculates the next Sunday at `00:00:00Z`, waits until that instant, posts the weekly submission embed to `WEEKLY_FLIGHT_CHANNEL_ID`, then calculates the next Sunday again. It therefore does not depend on the host machine's local timezone.

`/weekly-flight` posts the same announcement manually, but only in the configured weekly channel and for users with Manage Server permission.

### Combined deployment

The existing `npm start` command remains the FIDS entry point. When `DISCORD_TOKEN` is configured, `server.js` starts the Discord bot after Express starts. This allows a single Node service to host both components. On Render, add the Discord variables to the existing web service environment; the provided `render.yaml` contains placeholders for them.

For production, make sure only one process/service runs the bot. Do not run `node bot/index.js` separately on the same deployment if `DISCORD_TOKEN` is also configured for combined startup.

### Railway deployment

This project uses npm for Railway/Railpack builds. Keep `package.json` and `package-lock.json` available; Railway's current Railpack Node provider uses `npm install` for npm projects. Do not add a `pnpm-lock.yaml` unless it is intentionally generated and kept in sync with `package.json`, because Railpack will select pnpm when that lockfile is present and may use a frozen install.

The FIDS listing now shows a separate **Event** link next to the flight controls whenever `discordEvent` contains a valid Discord event URL. Flights without an event URL do not show an empty/broken event link.
