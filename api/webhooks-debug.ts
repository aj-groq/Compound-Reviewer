import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('Webhook called:', req.method, req.url);
    console.log('Headers:', req.headers);
    
    // Check environment variables
    const envVars = {
      GROQ_API_KEY: process.env.GROQ_API_KEY ? 'SET' : 'MISSING',
      APP_ID: process.env.APP_ID ? 'SET' : 'MISSING',
      PRIVATE_KEY: process.env.PRIVATE_KEY ? 'SET' : 'MISSING',
      WEBHOOK_SECRET: process.env.WEBHOOK_SECRET ? 'SET' : 'MISSING'
    };
    
    console.log('Environment variables:', envVars);
    
    return res.status(200).json({
      message: 'Debug webhook working',
      method: req.method,
      environment: envVars,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in debug webhook:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
