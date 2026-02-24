const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.post('/api/ask-tessa', async (req, res) => {
  try {
    const { messages, max_tokens, temperature } = req.body;

    // Separate system prompt from conversation messages
    // Anthropic requires system as a top-level field, not in messages array
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Anthropic requires strict user/assistant alternation
    // If conversation starts with assistant, prepend a user message
    if (conversationMessages.length > 0 && conversationMessages[0].role === 'assistant') {
      conversationMessages.unshift({ role: 'user', content: '(continued)' });
    }

    // Detect if this is a prelim analysis (long content = needs more tokens)
    const isPrelimAnalysis = conversationMessages.some(m => m.content && m.content.length > 5000);
    const resolvedMaxTokens = max_tokens || (isPrelimAnalysis ? 4096 : 1500);

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
        temperature: temperature !== undefined ? temperature : 0.3,
        system: systemMessage?.content || '',
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

    // Wrap Anthropic's response in OpenAI's format so the frontend doesn't need to change
    res.json({
      choices: [{
        message: {
          role: 'assistant',
          content: data.content?.[0]?.text || "I couldn't generate a response."
        }
      }]
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
  res.json({ status: 'ok', model: 'claude-sonnet-4-5-20250929' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tessa Proxy running on port ${PORT} (Anthropic Claude)`));
