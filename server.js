const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post('/api/ask-tessa', async (req, res) => {
  try {
    const { messages, max_tokens, temperature } = req.body;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: max_tokens || 2000,
        temperature: temperature !== undefined ? temperature : 0.3
      })
    });

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error(err);
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
      timeout: 10000 // 10 second timeout
    });
    
    if (!response.ok) {
      console.error(`Transfer tax source returned ${response.status}`);
      // Return empty array instead of erroring
      return res.json([]);
    }
    
    const data = await response.json();
    console.log(`Transfer tax data loaded: ${data.length} entries`);
    res.json(data);
    
  } catch (err) {
    console.error('Transfer tax data error:', err.message);
    // Return empty array so feature gracefully degrades
    res.json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tessa Proxy running on port ${PORT}`));

