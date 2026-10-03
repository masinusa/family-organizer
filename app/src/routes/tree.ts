import { Router, type Request } from "express";
import { isAdmin, requireAdmin } from "../middleware/access-control.js";
import { render } from "../lib/render.js";
import {
  peopleRepo,
  TOO_MANY_PARENTS_ERROR,
  SELF_PARENT_ERROR,
  CYCLE_PARENT_ERROR,
} from "../lib/people-repo.js";
import { buildTreeLayout } from "../lib/tree-layout.js";
import type { PersonInput } from "../lib/types.js";

export const treeRouter = Router();

const PARENT_ERRORS: string[] = [TOO_MANY_PARENTS_ERROR, SELF_PARENT_ERROR, CYCLE_PARENT_ERROR];

function parsePersonInput(body: Record<string, unknown>): PersonInput | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return { error: "Name is required." };
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  return { name, email: email || null };
}

function parseParentIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string" && v !== "");
  }
  return typeof raw === "string" && raw ? [raw] : [];
}

async function renderManage(req: Request, error: string | null): Promise<string> {
  const people = await peopleRepo.listPeople();
  return render("tree-manage", { people, error, email: req.user?.email, isAdmin: isAdmin(req), active: "admin" });
}

/** Returns null if the person doesn't exist, so callers can 404. */
async function renderPersonEdit(req: Request, id: string, error: string | null): Promise<string | null> {
  const [person, people] = await Promise.all([peopleRepo.getPerson(id), peopleRepo.listPeople()]);
  if (!person) return null;
  return render("tree-person-edit", {
    person,
    people,
    error,
    email: req.user?.email,
    isAdmin: isAdmin(req),
    active: "admin",
  });
}

treeRouter.get("/admin", async (req, res, next) => {
  try {
    const people = await peopleRepo.listPeople();
    const layout = buildTreeLayout(people);
    res.send(render("tree", { layout, email: req.user?.email, isAdmin: isAdmin(req), active: "admin" }));
  } catch (err) {
    next(err);
  }
});

treeRouter.get("/tree/manage", requireAdmin, async (req, res, next) => {
  try {
    res.send(await renderManage(req, null));
  } catch (err) {
    next(err);
  }
});

treeRouter.post("/tree/people", requireAdmin, async (req, res, next) => {
  try {
    const parsed = parsePersonInput(req.body);
    if ("error" in parsed) {
      res.status(400).send(await renderManage(req, parsed.error));
      return;
    }
    const person = await peopleRepo.createPerson(parsed);
    res.redirect(`/tree/people/${person.id}/edit`);
  } catch (err) {
    next(err);
  }
});

treeRouter.get("/tree/people/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const html = await renderPersonEdit(req, req.params.id, null);
    if (!html) {
      res.status(404).send("Person not found");
      return;
    }
    res.send(html);
  } catch (err) {
    next(err);
  }
});

treeRouter.post("/tree/people/:id", requireAdmin, async (req, res, next) => {
  try {
    const parsed = parsePersonInput(req.body);
    if ("error" in parsed) {
      const html = await renderPersonEdit(req, req.params.id, parsed.error);
      if (!html) {
        res.status(404).send("Person not found");
        return;
      }
      res.status(400).send(html);
      return;
    }
    await peopleRepo.updatePerson(req.params.id, parsed);
    res.redirect(`/tree/people/${req.params.id}/edit`);
  } catch (err) {
    next(err);
  }
});

treeRouter.post("/tree/people/:id/parents", requireAdmin, async (req, res, next) => {
  try {
    const parentIds = parseParentIds(req.body.parentIds);
    await peopleRepo.setParents(req.params.id, parentIds);
    res.redirect(`/tree/people/${req.params.id}/edit`);
  } catch (err) {
    if (err instanceof Error && PARENT_ERRORS.includes(err.message)) {
      const html = await renderPersonEdit(req, req.params.id, err.message);
      if (!html) {
        res.status(404).send("Person not found");
        return;
      }
      res.status(400).send(html);
      return;
    }
    next(err);
  }
});

treeRouter.post("/tree/people/:id/partners", requireAdmin, async (req, res, next) => {
  try {
    const partnerId = typeof req.body.partnerId === "string" ? req.body.partnerId : "";
    if (!partnerId || partnerId === req.params.id) {
      const html = await renderPersonEdit(req, req.params.id, "Choose a different person as a partner.");
      if (!html) {
        res.status(404).send("Person not found");
        return;
      }
      res.status(400).send(html);
      return;
    }
    await peopleRepo.addPartner(req.params.id, partnerId);
    res.redirect(`/tree/people/${req.params.id}/edit`);
  } catch (err) {
    next(err);
  }
});

treeRouter.post("/tree/people/:id/partners/:partnerId/remove", requireAdmin, async (req, res, next) => {
  try {
    await peopleRepo.removePartner(req.params.id, req.params.partnerId);
    res.redirect(`/tree/people/${req.params.id}/edit`);
  } catch (err) {
    next(err);
  }
});

treeRouter.post("/tree/people/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await peopleRepo.deletePerson(req.params.id);
    res.redirect("/tree/manage");
  } catch (err) {
    next(err);
  }
});
