import type { Request, Response, NextFunction } from "express";

const BEARER_RE = /^Bearer\s+(.+)$/i;
const IMPLANT_TOKEN_HEADER = "x-implant-token";

/**
 * Middleware: validates that the request has a valid operator API key.
 * ApiKey is set during server startup and compared via timing-safe-ish check.
 */
export function authenticateOperator(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }

    const match = header.match(BEARER_RE);
    if (!match || match[1] !== apiKey) {
      res.status(403).json({ error: "Invalid API key" });
      return;
    }

    next();
  };
}

/**
 * Middleware: validates that the request has a valid implant PSK token.
 */
export function authenticateImplant(implantToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers[IMPLANT_TOKEN_HEADER] as string | undefined;
    if (!token) {
      res.status(401).json({ error: "Missing implant token" });
      return;
    }

    if (token !== implantToken) {
      res.status(403).json({ error: "Invalid implant token" });
      return;
    }

    next();
  };
}
