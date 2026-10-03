import { Router, type Request } from "express";
import { create, list, updateStatus } from "../lib/feedback-repo.js";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  isFeedbackStatus,
  parseFeedbackInput,
} from "../lib/feedback-validation.js";
import { render } from "../lib/render.js";
import { isAdmin, requireAdmin } from "../middleware/access-control.js";

export const feedbackRouter = Router();

function renderFeedbackForm(req: Request, error: string | null, submitted: boolean) {
  return render("feedback-form", {
    categories: FEEDBACK_CATEGORIES,
    error,
    submitted,
    email: req.user?.email,
    isAdmin: isAdmin(req),
    active: null,
  });
}

feedbackRouter.get("/feedback", (req, res) => {
  res.send(renderFeedbackForm(req, null, req.query.submitted === "1"));
});

feedbackRouter.post("/feedback", async (req, res, next) => {
  try {
    const parsed = parseFeedbackInput(req.body);
    if ("error" in parsed) {
      res.status(400).send(renderFeedbackForm(req, parsed.error, false));
      return;
    }

    await create(parsed, req.user!.email);
    res.redirect("/feedback?submitted=1");
  } catch (err) {
    next(err);
  }
});

feedbackRouter.get("/admin/feedback", requireAdmin, async (req, res, next) => {
  try {
    const feedback = await list();
    res.send(
      render("admin-feedback", {
        feedback,
        statuses: FEEDBACK_STATUSES,
        error: null,
        email: req.user?.email,
        isAdmin: isAdmin(req),
        active: "admin",
      }),
    );
  } catch (err) {
    next(err);
  }
});

feedbackRouter.post("/admin/feedback/:id/status", requireAdmin, async (req, res, next) => {
  const status = req.body.status;
  if (!isFeedbackStatus(status)) {
    try {
      const feedback = await list();
      res.status(400).send(
        render("admin-feedback", {
          feedback,
          statuses: FEEDBACK_STATUSES,
          error: "Choose a valid feedback status.",
          email: req.user?.email,
          isAdmin: isAdmin(req),
          active: "admin",
        }),
      );
    } catch (err) {
      next(err);
    }
    return;
  }

  try {
    await updateStatus(req.params.id, status);
    res.redirect("/admin/feedback");
  } catch (err) {
    next(err);
  }
});
