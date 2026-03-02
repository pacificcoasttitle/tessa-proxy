const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Default settings per request type
// These kick in when the frontend doesn't send explicit temperature/max_tokens
const REQUEST_DEFAULTS = {
  prelim_extract:    { max_tokens: 4096, temperature: 0 },
  prelim_summarize:  { max_tokens: 2048, temperature: 0.1 },
  prelim_cheatsheet: { max_tokens: 2048, temperature: 0.2 },
  repair:            { max_tokens: 900,  temperature: 0 },
  chat:              { max_tokens: 1500, temperature: 0.3 }
};

app.post('/api/ask-tessa', async (req, res) => {
  try {
    const { messages, max_tokens, temperature, request_type, response_format } = req.body;

    // Separate system prompt from conversation messages
    // Anthropic requires system as a top-level field, not in messages array
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Anthropic requires strict user/assistant alternation
    // If conversation starts with assistant, prepend a user message
    if (conversationMessages.length > 0 && conversationMessages[0].role === 'assistant') {
      conversationMessages.unshift({ role: 'user', content: '(continued)' });
    }

    // Determine request type:
    // 1. Explicit request_type from frontend (preferred)
    // 2. Fallback: length heuristic (backward compatible with existing frontend)
    const detectedType = request_type ||
      (conversationMessages.some(m => m.content && m.content.length > 5000) ? 'prelim_extract' : 'chat');

    const defaults = REQUEST_DEFAULTS[detectedType] || REQUEST_DEFAULTS.chat;

    // Build system prompt
    let systemPrompt = systemMessage?.content || '';

    // If frontend requests JSON output, append a strict JSON instruction
    if (response_format === 'json') {
      systemPrompt += '\n\nCRITICAL: You MUST respond with valid JSON only. No markdown, no backticks, no preamble, no explanation outside the JSON structure. Start your response with { and end with }.';
    }

    // Resolve final parameters:
    // - Explicit values from frontend override everything
    // - Otherwise use request_type defaults
    const resolvedMaxTokens = max_tokens || defaults.max_tokens;
    const resolvedTemperature = (temperature !== undefined && temperature !== null)
      ? temperature
      : defaults.temperature;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: resolvedMaxTokens,
        temperature: resolvedTemperature,
        system: systemPrompt,
        messages: conversationMessages
      })
    });

    const data = await response.json();

    // If Anthropic returned an error, log it and send a friendly message
    if (data.type === 'error') {
      console.error('Anthropic API error:', data.error);
      return res.json({
        choices: [{
          message: {
            content: "I'm having trouble processing that request. Please try again in a moment."
          }
        }]
      });
    }

    const content = data.content?.[0]?.text || "I couldn't generate a response.";

    // Wrap Anthropic's response in OpenAI's format so the frontend doesn't need to change
    res.json({
      choices: [{
        message: {
          role: 'assistant',
          content: content
        }
      }],
      // Pass through Anthropic's token usage for cost tracking
      usage: data.usage || null,
      // Debug metadata — helps diagnose what settings were actually used
      _meta: {
        request_type: detectedType,
        temperature: resolvedTemperature,
        max_tokens: resolvedMaxTokens,
        response_format: response_format || 'markdown'
      }
    });

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Error processing your request' });
  }
});

// Transfer tax data proxy (fixes CORS issue)
app.get('/data.json', async (req, res) => {
  try {
    console.log('Fetching transfer tax data...');
    const response = await fetch('https://pacificcoasttitle.onrender.com/data.json', {
      headers: {
        'User-Agent': 'TessaProxy/1.0'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.error(`Transfer tax source returned ${response.status}`);
      return res.json([]);
    }

    const data = await response.json();
    console.log(`Transfer tax data loaded: ${data.length} entries`);
    res.json(data);
  } catch (err) {
    console.error('Transfer tax data error:', err.message);
    res.json([]);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    model: 'claude-sonnet-4-5-20250929',
    version: '2.1.0'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tessa Proxy v2.1 running on port ${PORT} (Anthropic Claude)`));
