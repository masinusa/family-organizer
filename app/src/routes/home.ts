import { Router } from "express";
import { render } from "../lib/render.js";

export const homeRouter = Router();

homeRouter.get("/", (req, res) => {
  res.send(render("home", { email: req.user?.email }));
});
