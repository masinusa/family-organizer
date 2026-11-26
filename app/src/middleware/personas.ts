import type { NextFunction, Request, Response } from "express";
import { peopleRepo } from "../lib/people-repo.js";
import { PersonaDirectory, type Persona } from "../lib/persona.js";
import { usersRepo } from "../lib/users-repo.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Everyone, resolved once per request — see lib/persona.ts. */
    personas?: PersonaDirectory;
    /** The (effective) viewer's own persona. */
    persona?: Persona;
  }
}

export async function loadPersonaDirectory(): Promise<PersonaDirectory> {
  const [people, users] = await Promise.all([peopleRepo.listPeople(), usersRepo.listUsers()]);
  return new PersonaDirectory(people, users);
}

/**
 * Runs right after requireFamilyMember, so every page can draw anyone —
 * the top bar included — without each route re-reading and re-joining
 * `people` and `users` itself. Two reads per request, at family scale.
 */
export async function loadPersonas(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const personas = await loadPersonaDirectory();
    const persona = personas.byEmail(req.appUser!.email);
    if (!persona) {
      // Unreachable while the directory refuses orphan accounts.
      throw new Error(`${req.appUser!.email} has an account but no persona.`);
    }
    req.personas = personas;
    req.persona = persona;
    next();
  } catch (err) {
    // Express 4 doesn't catch a rejected promise from middleware.
    next(err);
  }
}
