// AuthStrategy enables use to use different authentication methods depending on our environment configuration
// In general, Oauth will be used for local development, while Kong will be used in dev/test/prod openshift

import { Request, Response } from 'express';

export interface AuthStrategy {
  /**
   * Handle login initiation
   * Kong: Expects X-Userinfo header and processes immediately
   * BCSC: Redirects to BCSC OAuth
   */
  handleLogin(req: Request, res: Response): Promise<void>;

  /**
   * Handle GET callback (OAuth redirect)
   * Kong: Processes X-Userinfo header
   * BCSC: Exchanges code for tokens
   */
  handleGetCallback(req: Request, res: Response): Promise<void>;

  /**
   * Handle POST callback (frontend-driven)
   * Kong: Not supported, returns error
   * BCSC: Exchanges code from body
   */
  handlePostCallback(
    req: Request,
    res: Response,
    body: { code: string; redirect_uri: string },
  ): Promise<void>;

  /**
   * Handle logout
   * Kong: Redirects to Kong logout endpoint
   * BCSC: Clears session and redirects to frontend
   */
  handleLogout(req: Request, res: Response): void;
}
