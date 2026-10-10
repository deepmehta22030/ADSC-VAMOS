# QueueLess — Code Carnival 3.0 Hackathon Demo

A full-stack Smart Governance prototype for virtual tokens at nearby municipal offices. This version includes the corrected JSX, a React/Vite interface, an Express REST API, JWT sessions, bcrypt password hashing, JSON persistence, QR tokens, queue operations, worker capacity, analytics, notifications, a Leaflet/OpenStreetMap map, and English/Gujarati/Hindi UI labels.

## Run locally

**Requirements:** Node.js 18+ and npm. Internet access is needed the first time to install packages and for OpenStreetMap tiles.

1. Extract this ZIP.
2. Open a terminal in the extracted `QueueLess` folder.
3. Run:

   ```bash
   npm install
   npm run dev
   ```

4. Open `http://localhost:5173`.
5. Backend health check: `http://localhost:4000/api/health`.

`npm run dev` starts the frontend and backend together. Keep that terminal open while presenting.

## Office recess schedule

- Daily admin/officer recess: **12:30 PM–1:30 PM** (server local time).
- Citizen token booking remains open during recess (within the 10:00 AM–5:00 PM booking window).
- Officer actions to call the next token or skip a missing token are paused during recess. Wait estimates add the remaining recess minutes to the normal queue estimate, and update as recess approaches its end.
- The backend exposes `GET /api/office-status` for the current schedule.

## Demo accounts

- Citizen: `citizen@demo.com` / `123456`
- Officer: `admin@demo.com` / `admin123`

## Suggested 3-minute judge demo

1. Open the landing page and sign in as the citizen demo.
2. Show nearby municipal office options and service/document/fee guidance.
3. Try booking a token. The API only permits token creation from 10:00 AM through 5:00 PM according to the server's local clock.
4. Show the QR pass, queue estimate, map and simulated reminder.
5. Sign out and sign in as the officer demo.
6. Call the next citizen, skip a missing token, toggle a worker, and show the queue/analytics/QR verification panels.
7. Change language to Gujarati and Hindi. Open the new Recess Monitor tab in the officer console to review recess status, active tokens booked during recess, and adjusted waiting estimates.

## Important demo limitations

This is a hackathon prototype, not a deployed government service. Queue prediction, route/travel estimates, QR camera scanning, notifications and analytics are demo/simulated features. Office locations and distances are seeded sample data for Rajkot; the “use my location” control is a prototype UI, not a verified eligibility or geofencing system. OpenStreetMap tiles require internet. SMS, official government systems, live GPS tracking, production-grade QR validation, database migrations and deployment are not connected. Do not present sample fees/documents as official advice.

## Data and security notes

The API persists demo data in `server/data.json` when first used. Deleting that file resets seeded demo data. The demo JWT secret is hard-coded as a local fallback; configure `JWT_SECRET` for any non-demo deployment. This code is intended for a local hackathon presentation, not production use.


## Payment options (Razorpay + pay at office)

The citizen booking screen now lets the user choose **Pay online with Razorpay** or **Pay at the office**.

### Configure Razorpay test mode

1. Create a Razorpay account and obtain API keys from the Razorpay Dashboard (use **Test Mode** for a demo).
2. Copy `.env.example` to `.env` in the project root.
3. Create `.env` in the **project root** (the same folder as `package.json`), not inside `src/`. Set the exact names `RAZORPAY_KEY_ID=rzp_test_...` and `RAZORPAY_KEY_SECRET=...`. The server explicitly loads this root `.env` using dotenv. Keep the secret only on the server; never put it in React/Vite variables or commit `.env`.
4. Stop any running dev server, run `npm install` to install dotenv, then restart with `npm run dev`. Vite/server must be restarted after changing `.env`. Test with a fixed-fee service such as Aadhaar Update or PAN Services during the booking window (10:00 AM–5:00 PM).
5. The backend creates the Razorpay order, validates the checkout signature, and checks the payment status with Razorpay before issuing the QR token.

If Razorpay credentials are not configured, online payment shows a clear setup message and users can still book using **Pay at the office**. Office-payment tokens are marked `pay_at_office`; successful online payments are marked `paid` and store the Razorpay payment ID. Variable-fee services (Property / Tax and Other Municipal Service) are not eligible for online payment in this demo.

### Fee configuration and limitations

The current demo fee map is defined server-side in `server/server.js`: Aadhaar Update ₹50, PAN Services ₹110, Birth Certificate ₹20, and Income / Caste Certificate ₹20. These are illustrative values inherited from the prototype UI, not confirmed official fees. Update the server-side map only after confirming actual fees with the relevant office. Configure Razorpay webhooks and add a persistent production database before deploying for real payments; the included JSON file storage is for a hackathon demo only.

## New features: Offline Pass + QueueLess Anywhere

### Offline Pass
- The app registers a service worker and caches the app shell and same-origin static assets after they have loaded.
- The citizen's last-issued ticket is saved locally in the browser and can be viewed from **Offline Pass** when connectivity drops. The screen includes the saved QR payload and marks details as the last-synced state.
- Offline mode is read-only: creating reservations, changing queue status, syncing new booking changes, and making payments still require the backend connection. The browser cache is device/browser-specific; clearing site data removes the saved pass.

### QueueLess Anywhere
- Compare the seeded Rajkot demo branches by estimated queue wait plus a demo travel-time estimate.
- The page shows queue wait, travel estimate, and an illustrative open-slot heuristic based on active counters and waiting visitors.
- Selecting a branch switches the booking flow to that office. Queue wait comes from the API; travel time and estimated open slots are prototype values, not guaranteed live data.

### Offline demo tip
1. Sign in and book a token while online.
2. Open **Offline Pass** and save/refresh the pass.
3. Disconnect the network and revisit the cached app to demonstrate the saved ticket.
4. Reconnect and use **QueueLess Anywhere** to compare branches and choose an office.
