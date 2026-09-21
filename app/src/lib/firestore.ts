import { Firestore } from "@google-cloud/firestore";

/**
 * Single shared client. In local dev, set FIRESTORE_EMULATOR_HOST (e.g.
 * localhost:8085) and this connects to the emulator instead of real GCP —
 * @google-cloud/firestore reads that env var automatically.
 */
export const firestore = new Firestore();
