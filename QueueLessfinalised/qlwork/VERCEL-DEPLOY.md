# QueueLess — Vercel deployment fix

## Changes included
- Frontend API defaults to the same-origin `/api` instead of `http://localhost:4000/api`.
- Added `api/[...path].js` as a Vercel serverless entry point for the existing Express API.
- `server/server.js` exports the Express app and only calls `app.listen()` for local development.
- Added `vercel.json` build/output/function configuration.

## Deploy
1. Commit and push these changes to the GitHub repository connected to Vercel, or upload this project as a new deployment.
2. In Vercel Project Settings → Environment Variables, configure `JWT_SECRET` to a long random secret.
3. Configure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` only if using Razorpay. Never put the Razorpay secret in a `VITE_` variable.
4. Redeploy the Production deployment.
5. Open `https://YOUR-DEPLOYMENT.vercel.app/api/health`. Expected response is JSON with `ok: true`.
6. Open the site, sign in, and test Office Payment during the app's 10:00 AM–5:00 PM booking window. Then inspect DevTools → Network. Requests must use `/api/...`, not `localhost:4000`.

## Important storage limitation
This project currently stores users, tokens, and other app data in `server/data.json`. Vercel serverless functions have ephemeral/read-only deployment filesystems; changes written to this file are NOT reliable persistent storage and can fail. This patch fixes the local API URL and adds a Vercel function entry point, but it does not make JSON-file storage production-safe. For durable accounts and tokens, migrate the `db()`/`save()` functions to a persistent database (for example, Postgres or another managed database) before relying on it for real users. Do not use this demo setup for real payments or sensitive personal data until storage and payment verification are production-ready.

## If `/api/health` fails
Check Vercel → Deployments → latest deployment → Functions/Logs. Confirm the project root is the directory containing `package.json`, `src/`, `server/`, `api/`, and `vercel.json`.
