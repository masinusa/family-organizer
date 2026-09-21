# family-hub app

Node.js + TypeScript + Express, server-rendered (no SPA build step). Data
lives in Firestore. See `docs/adr/0005-node-typescript-firestore.md` for why.

## Local development

There's no real IAP or Firestore available locally, so both are stubbed:

1. **Firestore emulator** — install once (`gcloud components install
   cloud-firestore-emulator` or `npm i -g firebase-tools`), then run:
   ```
   gcloud emulators firestore start --host-port=localhost:8085
   # or: firebase emulators:start --only firestore
   ```
   Export `FIRESTORE_EMULATOR_HOST=localhost:8085` before starting the app —
   `@google-cloud/firestore` picks this up automatically and skips real GCP
   auth entirely.

2. **IAP bypass** — set `DEV_USER_EMAIL=you@example.com`. With
   `NODE_ENV` unset (anything other than `production`), requests with no
   `X-Goog-IAP-JWT-Assertion` header are treated as that email instead of
   being rejected. This path is hard-disabled whenever `NODE_ENV=production`
   — see `src/middleware/iap-auth.ts`.

3. Install deps and run:
   ```
   npm install
   FIRESTORE_EMULATOR_HOST=localhost:8085 DEV_USER_EMAIL=you@example.com npm run dev
   ```
   The app listens on `:8080` (override with `PORT`).

4. Tests (`npm test`) don't need the emulator — they stub the IAP public-key
   fetch instead of hitting real Google infrastructure.

## Deployed environment

`GCP_PROJECT_NUMBER`, `GCP_REGION`, and `GCP_SERVICE_NAME` are set by
Terraform (`infra/terraform/cloud_run.tf`) and used to build the audience
string the real IAP assertion is verified against. `DEV_USER_EMAIL` is never
set in the deployed image, and the bypass path is also gated on
`NODE_ENV=production` as a second guard.
