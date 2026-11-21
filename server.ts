import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL_NAME = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: unknown): { status: number; message: string; code: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const statusMatch = raw.match(/\b(400|401|403|404|429|500|503)\b/);
  const status = statusMatch ? Number(statusMatch[1]) : 500;

  if (
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED') ||
    status === 400 ||
    status === 403
  ) {
    return {
      status: status === 403 ? 403 : 400,
      code: 'GEMINI_KEY_ERROR',
      message:
        'Gemini API key is invalid or lacks permission. Please verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || status === 429) {
    return {
      status: 429,
      code: 'GEMINI_QUOTA_EXCEEDED',
      message: 'Gemini API rate limit or quota exceeded. Please try again shortly or check Settings > Secrets.',
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    code: 'GEMINI_UPSTREAM_ERROR',
    message: `Gemini API request failed: ${raw}`,
  };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(getGeminiClient()),
      model: MODEL_NAME,
    });
  });

  // 1. Inventory Chatbot Endpoint
  app.post('/api/gemini/chat', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        code: 'GEMINI_NOT_CONFIGURED',
        error:
          'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets to enable live Gemini responses.',
      });
    }

    const { message, history, inventoryContext } = req.body ?? {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message text is required.' });
    }

    const safeHistory = Array.isArray(history)
      ? history
          .slice(-8)
          .map((h: { role?: string; content?: string }) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content ?? ''}`)
          .join('\n')
      : '';

    const systemInstruction = [
      'You are the SmartStock AI Inventory Assistant for a small business (Northwind Pantry & Brew Co.).',
      'Answer concisely, accurately, and warmly using ONLY the provided live inventory context.',
      'Be explicit when citing numbers (quantities, dollar values, SKUs, suppliers, POs).',
      'CRITICAL: You are read-only and must NEVER claim you changed stock or placed an order.',
      'If the user asks what needs reordering or asks to restock a specific low/out-of-stock item, you may include proposedReorder with the matching productId from the catalog and a sensible positive integer quantity so the UI can show a confirmation button.',
      'Always keep replies clear, scannable, and under 140 words.',
    ].join(' ');

    const prompt = [
      'LIVE INVENTORY CONTEXT (JSON):',
      JSON.stringify(inventoryContext ?? {}),
      safeHistory ? `\nRECENT CONVERSATION:\n${safeHistory}` : '',
      `\nUSER QUESTION:\n${message.trim()}`,
    ].join('\n');

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description: 'Helpful, accurate conversational response grounded in the live inventory data.',
              },
              proposedReorderProductId: {
                type: Type.STRING,
                description: 'Optional productId from inventoryContext.products if proposing a reorder confirmation button, otherwise empty string.',
              },
              proposedReorderQty: {
                type: Type.INTEGER,
                description: 'Optional positive integer reorder quantity if proposing a reorder, otherwise 0.',
              },
            },
            required: ['reply'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as {
        reply?: string;
        proposedReorderProductId?: string;
        proposedReorderQty?: number;
      };

      return res.json({
        reply: parsed.reply || 'I checked your inventory data, though no summary text was returned.',
        proposedReorderProductId: parsed.proposedReorderProductId || '',
        proposedReorderQty: Number(parsed.proposedReorderQty) || 0,
        model: MODEL_NAME,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 2. Customer Response Drafting Endpoint
  app.post('/api/gemini/customer-response', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        code: 'GEMINI_NOT_CONFIGURED',
        error:
          'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets to draft responses with Gemini.',
      });
    }

    const { inquiry, inventoryContext, tone } = req.body ?? {};
    if (!inquiry || typeof inquiry.message !== 'string') {
      return res.status(400).json({ error: 'Customer inquiry details are required.' });
    }

    const systemInstruction = [
      'You are a helpful customer operations specialist replying on behalf of Northwind Pantry & Brew Co.',
      'Draft a clear, friendly, accurate customer reply grounded strictly in the provided live inventory and purchase order ETAs.',
      'If an item is out of stock, check openPurchaseOrders in the context and mention the expected arrival date if one exists, or politely offer an alternative.',
      'Never invent tracking numbers, discounts, or dates not present in the context.',
      `Tone requested: ${typeof tone === 'string' ? tone : 'Warm & Professional'}.`,
      'Write only the customer-facing reply body (greeting, helpful answer, clear sign-off as Northwind Support Team).',
    ].join(' ');

    const prompt = [
      'CUSTOMER INQUIRY:',
      JSON.stringify(inquiry),
      '\nLIVE STORE INVENTORY & OPEN PURCHASE ORDERS:',
      JSON.stringify(inventoryContext ?? {}),
    ].join('\n');

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction,
        },
      });

      const draft = (response.text ?? '').trim();
      if (!draft) {
        return res.status(502).json({ error: 'Gemini returned an empty draft response.' });
      }
      return res.json({ draft, model: MODEL_NAME });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 3. AI Insights Summary Endpoint
  app.post('/api/gemini/insights', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        code: 'GEMINI_NOT_CONFIGURED',
        error:
          'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets to generate live Gemini insights.',
      });
    }

    const { inventoryContext } = req.body ?? {};
    const systemInstruction = [
      'You are an inventory operations analyst for Northwind Pantry & Brew Co.',
      'Generate a concise daily executive inventory briefing grounded strictly in the provided JSON snapshot.',
      'Keep each highlight and recommended action factual and under 25 words.',
    ].join(' ');

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `INVENTORY SNAPSHOT:\n${JSON.stringify(inventoryContext ?? {})}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              highlights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              recommendedActions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['headline', 'highlights', 'recommendedActions'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        headline?: string;
        highlights?: string[];
        recommendedActions?: string[];
      };

      return res.json({
        headline: parsed.headline || 'Inventory summary updated',
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 4) : [],
        recommendedActions: Array.isArray(parsed.recommendedActions)
          ? parsed.recommendedActions.slice(0, 4)
          : [],
        model: MODEL_NAME,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SmartStock AI server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
