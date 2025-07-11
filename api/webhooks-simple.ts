import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Basic webhook validation
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
    }
    
    // Dynamic import to avoid build-time issues
    const { createNodeMiddleware, createProbot } = await import("probot");
    const { robot } = await import("../src/bot.js");
    
    const probot = createProbot();
    const middleware = createNodeMiddleware(robot, { probot, webhooksPath: '/api/webhooks-simple' });
    
    return middleware(req, res);
    
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
