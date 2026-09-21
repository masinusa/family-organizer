import type { NextFunction, Request, Response } from "express";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  console.error(err);
  if (res.headersSent) {
    return;
  }
  res.status(500).send("Something went wrong.");
}
