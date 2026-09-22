import { Router, type Request } from "express";
import { isAdmin, requireAdmin } from "../middleware/access-control.js";
import { render } from "../lib/render.js";
import * as usersRepo from "../lib/users-repo.js";
import { LAST_ADMIN_ERROR } from "../lib/users-repo.js";
import type { UserRole } from "../lib/types.js";

export const adminRouter = Router();

const VALID_ROLES: UserRole[] = ["admin", "member"];

async function renderUsers(req: Request) {
  const users = await usersRepo.listUsers();
  return render("admin-users", {
    users,
    email: req.user?.email,
    isAdmin: isAdmin(req),
    active: "admin",
  });
}

async function renderManage(req: Request, error: string | null) {
  const users = await usersRepo.listUsers();
  return render("admin-manage", {
    users,
    error,
    email: req.user?.email,
    isAdmin: isAdmin(req),
    active: "admin",
  });
}

adminRouter.get("/admin", async (req, res, next) => {
  try {
    res.send(await renderUsers(req));
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/admin/manage", requireAdmin, async (req, res, next) => {
  try {
    res.send(await renderManage(req, null));
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
    const role = req.body.role;
    if (!email || !VALID_ROLES.includes(role)) {
      res.status(400).send(await renderManage(req, "A valid email and role are required."));
      return;
    }
    await usersRepo.createUser(email, role as UserRole);
    res.redirect("/admin/manage");
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/users/:email/role", requireAdmin, async (req, res, next) => {
  try {
    const role = req.body.role;
    if (!VALID_ROLES.includes(role)) {
      res.status(400).send(await renderManage(req, "Invalid role."));
      return;
    }
    await usersRepo.setRole(req.params.email, role as UserRole);
    res.redirect("/admin/manage");
  } catch (err) {
    if (err instanceof Error && err.message === LAST_ADMIN_ERROR) {
      res.status(400).send(await renderManage(req, err.message));
      return;
    }
    next(err);
  }
});

adminRouter.post("/admin/users/:email/delete", requireAdmin, async (req, res, next) => {
  try {
    await usersRepo.deleteUser(req.params.email);
    res.redirect("/admin/manage");
  } catch (err) {
    if (err instanceof Error && err.message === LAST_ADMIN_ERROR) {
      res.status(400).send(await renderManage(req, err.message));
      return;
    }
    next(err);
  }
});
