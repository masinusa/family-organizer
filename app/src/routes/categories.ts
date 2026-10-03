import { Router } from "express";
import { parseMonthQuery, renderCalendarPage } from "../lib/calendar-page.js";
import { createCategory } from "../lib/categories.js";

export const categoriesRouter = Router();

/**
 * Open to every family member, not just admins: whoever is planning the trip
 * should be able to label it without waiting on someone else.
 */
categoriesRouter.post("/categories", async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name : "";
    const color = typeof req.body.color === "string" ? req.body.color : "";
    const result = await createCategory(name, color, req.user!.email);

    // The month the legend was opened from, round-tripped through the form
    // so a success lands back on it and a failure re-renders it.
    const selection = parseMonthQuery(req.body);
    if ("error" in result) {
      res.status(400).send(await renderCalendarPage(req, selection, result.error));
      return;
    }
    res.redirect(`/?year=${selection.year}&month=${selection.month}`);
  } catch (err) {
    next(err);
  }
});
