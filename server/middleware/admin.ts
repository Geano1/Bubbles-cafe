import { Request, Response, NextFunction } from 'express';

export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  
  if (!(req.user as any)?.isAdmin) {
    return res.status(403).json({ message: "Access denied: Admin privileges required" });
  }

  next();
};
