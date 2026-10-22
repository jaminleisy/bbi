# BenBot Inventory

An online inventory management system for gaming computer parts and PC builds.

- **Backend:** ASP.NET Core 8 Web API (C#) with Entity Framework Core
- **Database:** Microsoft SQL Server (string-keyed lookup tables for easy manual querying)
- **Frontend:** Angular with Angular Material UI (served from the ASP.NET wwwroot in production)
- **Auth:** JWT bearer tokens; users log in with a user ID + password.
  `Users.PermissionLevel` controls access: **1** Builds only, **2** Computers
  + Parts (view) + edit computers / assign builders, **3** full access including
  edit parts and the Users admin page.

## Project Layout

```
BenBotInventory/
├── Server/     ASP.NET Core Web API (+ serves the built Angular app)
└── client/     Angular + Angular Material frontend
```

## Testing Locally with Visual Studio

1. Open `BenBotInventory.slnx` in Visual Studio.
2. Press **F5** (or Ctrl+F5) to run the **Server** project with the `http`
   profile — it starts on **http://localhost:5000**, creates the LocalDB
   database, and seeds all lookup data automatically.
3. In a terminal (or the VS Terminal window), start the Angular dev server:
   ```
   cd client
   npm install   (first time only)
   npm start
   ```
4. Open **http://localhost:4200** in your browser and log in with
   user ID `admin`, password `admin`.

The Angular dev server (port 4200) calls the API on port 5000 (CORS is
enabled for this in Development). Alternatively, to test the fully bundled
site exactly as it will be deployed, publish and run the output:
```
cd Server
dotnet publish -c Release -o ..\publish
cd ..\publish
dotnet BenBotInventory.Server.dll --urls http://localhost:5000
```
Then browse to http://localhost:5000 — the Angular app is served from
wwwroot by ASP.NET.

## Connecting with SQL Server Management Studio (SSMS)

The app uses the **SQL Server LocalDB** instance `MSSQLLocalDB`. To browse
the database in SSMS:

1. Open SSMS → **Connect** → **Database Engine**.
2. Server name: `(localdb)\MSSQLLocalDB`
3. Authentication: **Windows Authentication**
4. Click **Connect**, then expand **Databases → BenBotInventory**.

(The database is created the first time you run the Server project.)
Example query:
```sql
USE BenBotInventory;
SELECT p.*, c.Name AS ComputerName
FROM Parts p
LEFT JOIN Computers c ON c.Id = p.ComputerId
JOIN PartTypes t ON t.Type = p.Type
ORDER BY p.Type;
```
If the instance isn't running, start it from a command prompt with
`sqllocaldb start MSSQLLocalDB`. If you'd rather use a full SQL Server
instance, change `ConnectionStrings:DefaultConnection` in
`Server/appsettings.json` (e.g. `Server=localhost;Database=BenBotInventory;...`)
and connect SSMS to that same server name instead.

## Getting Started (Development)



1. **Database** — the default connection string uses SQL Server LocalDB
   (`Server/appsettings.json` → `ConnectionStrings:DefaultConnection`).
   Point it at any SQL Server instance you like. The database, tables, and
   seed data (part types, conditions, sellers, sockets, etc.) are created
   automatically at startup.

2. **Run the backend** (http://localhost:5000):
   ```
   cd Server
   dotnet run
   ```

3. **Run the frontend dev server** (http://localhost:4200, proxies API calls to :5000):
   ```
   cd client
   npm install
   npm start
   ```

4. **Log in** with the seeded account: user ID `admin`, password `admin`.
   Register more users via `POST /api/auth/register` (requires being logged in).
   **Change the admin password and the JWT key before deploying!**

## Deployment (ASP.NET Web Publish)

Publishing the Server project automatically runs `ng build` and copies the
Angular output into `wwwroot`, so one publish produces the whole site:

```
cd Server
dotnet publish -c Release -o <output-folder>
```

Or use Visual Studio's right-click **Publish** on the Server project
(folder, IIS, or Azure). Remember to set a production connection string and
a strong `Jwt:Key` (environment variables or publish-time config transforms).

## Key Features

- **Computers view (main page):** all builds sorted by deposit → Needs repair →
  Active → Built → Personal → In-progress → Planned → Returned → Traded. Sold
  builds are on the Sold page. Traded and Personal are hidden by default
  (toggles to show them). Shows name, status, location, builder, total parts
  cost, price, profit (estimated until sold), deposit/payment indicators,
  conversation link, shipping indicator, and a warning when a "PC" build is
  missing required part types (suppressible per-computer via **Ignore
  Incomplete**). Rows expand to show/edit the parts list, payments, and wages.
- **Payments:** record payments/deposits/refunds per computer. `Computer.Price`
  and `Payment.Amount` are **tax-inclusive** (tax is a portion of that total,
  not added on top). When net paid covers price, the build flips to **Sold**.
  Profit is `(Price − Tax) − Parts Cost`.
- **Monthly Summary:** year-by-year totals of sold PCs by sale date — total
  sales (tax-inclusive), exempt sales, before-tax revenue, tax due, parts cost,
  wages (by paid date), and profit (pretax − parts − wages), matching the
  spreadsheet monthly TAXES rows. Expand a month to see each sale.
- **Wages:** builder payouts (`BuilderUserId`, amount, paid date/method,
  notes). Imported from the Builds sheet (Josh split columns + Branden Misc 3
  entries). API at `/api/wages`.
- **Parts view:** defaults to unassigned inventory only (toggle **Show
  assigned** to include parts on computers). List view groups by type with
  inline location/condition editing; **Grid** view lays out one column per
  part type (manufacturer / model / cost; Ben=green, Josh=blue; click to
  edit). Filter toggles for not-received / needs-testing, plus search by
  type, seller, manufacturer, model, socket, RAM type, PCIe gen, etc.
- **Builds page (lower permission):** `/builds` lists PC builds the logged-in
  user may see based on `Users.BuildAccess` (comma-separated builder names
  matched to `Computer.BuilderUserId`, `Unassigned` for builds with no
  builder, or `All` for every build). Only
  Planned / In-progress / Built / Active builds are shown, plus Sold builds
  from the last 60 days. Shows name, status, and part manufacturer/model only
  — no pricing.
  Detail page `/builds/{id}` lets users add notes (stored in `BuildNotes`,
  attributed with user + date).
- **Public build page:** `/build/{id}` is viewable without logging in and
  shows the build name, expected completion date, and parts list. Use the
  share button on a computer row to copy the link.
- **Lookup tables:** `PartTypes` (type + required), `Sellers`, `CpuSockets`,
  `PcieGens`, `RamTypes`, `Locations`, `Conditions` — all string-keyed so
  manual SQL is simple (`JOIN` on the actual string values).

## Database Notes

- Parts can belong to at most one computer (`Parts.ComputerId`).
- Individual parts are never "sold" — assign them to a computer of type
  `Parts` (or `PC`) and record a payment on that computer.
- Required part types for a complete PC are flagged in `PartTypes.Required`
  (case, psu, gpu, mobo, cpu, cpuCooler, storage, ram by default).
