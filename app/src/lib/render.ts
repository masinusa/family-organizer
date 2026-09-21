import { Eta } from "eta";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(here, "..", "views");

const eta = new Eta({ views: viewsDir, cache: process.env.NODE_ENV === "production" });

export function render(template: string, data: Record<string, unknown> = {}): string {
  const html = eta.render(template, data);
  if (typeof html !== "string") {
    throw new Error(`Template "${template}" did not render synchronously`);
  }
  return html;
}
