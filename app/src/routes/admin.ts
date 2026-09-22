import { Router } from "express";
import { requireAdmin } from "../middleware/access-control.js";
import { render } from "../lib/render.js";
import * as usersRepo from "../lib/users-repo.js";
import { LAST_ADMIN_ERROR } from "../lib/users-repo.js";
import type { UserRole } from "../lib/types.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

const VALID_ROLES: UserRole[] = ["admin", "member"];

async function renderUsers(error: string | null) {
  const users = await usersRepo.listUsers();
  return render("admin-users", { users, error });
}

adminRouter.get("/admin", async (_req, res, next) => {
  try {
    res.send(await renderUsers(null));
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/users", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
    const role = req.body.role;
    if (!email || !VALID_ROLES.includes(role)) {
      res.status(400).send(await renderUsers("A valid email and role are required."));
      return;
    }
    await usersRepo.createUser(email, role as UserRole);
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/users/:email/role", async (req, res, next) => {
  try {
    const role = req.body.role;
    if (!VALID_ROLES.includes(role)) {
      res.status(400).send(await renderUsers("Invalid role."));
      return;
    }
    await usersRepo.setRole(req.params.email, role as UserRole);
    res.redirect("/admin");
  } catch (err) {
    if (err instanceof Error && err.message === LAST_ADMIN_ERROR) {
      res.status(400).send(await renderUsers(err.message));
      return;
    }
    next(err);
  }
});

adminRouter.post("/admin/users/:email/delete", async (req, res, next) => {
  try {
    await usersRepo.deleteUser(req.params.email);
    res.redirect("/admin");
  } catch (err) {
    if (err instanceof Error && err.message === LAST_ADMIN_ERROR) {
      res.status(400).send(await renderUsers(err.message));
      return;
    }
    next(err);
  }
});
