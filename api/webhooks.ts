import { VercelRequest, VercelResponse } from '@vercel/node';
import { createNodeMiddleware, createProbot } from "probot";
import { robot as app } from "../src/bot";

const probot = createProbot();
const middleware = createNodeMiddleware(app, { probot, webhooksPath: '/api/webhooks' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return middleware(req, res);
}