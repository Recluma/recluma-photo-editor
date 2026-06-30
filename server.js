const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── OpenAI key lives ONLY here, server-side, never sent to the browser ────────
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim().replace(/[^A-Za-z0-9_-]+$/, '');

if (!OPENAI_API_KEY) {
  console.warn('⚠️  WARNING: OPENAI_API_KEY environment variable is not set.');
}

const STYLE_DESC = {
  premium: 'professional premium real estate photography with perfect color grading, natural daylight white balance, balanced exposure showing both interior details and window views, clean and inviting atmosphere',
  bright:  'bright and airy real estate photography with lifted shadows, clean neutral-white walls, abundant natural light, modern fresh feel',
  warm:    'warm and cozy real estate photography with golden-hour tones, enhanced wood textures, soft inviting lighting, homey atmosphere',
  dramatic:'dramatic luxury real estate photography with rich deep shadows, high contrast, architectural emphasis, editorial magazine quality'
};

// ── Single endpoint: takes a photo, returns the edited photo ──────────────────
app.post('/api/process-photo', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server is not configured with an OpenAI API key.' });
  }

  const { imageB64, style, size } = req.body;
  if (!imageB64) return res.status(400).json({ error: 'imageB64 is required' });

  try {
    // Step 1: GPT-4o Vision — describe the room
    const vResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}`, detail: 'high' } },
            {
              type: 'text',
              text: `You are a real estate photography expert. Describe this property photo in precise detail for photorealistic recreation. Include ALL of the following:
- Room type (living room, bedroom, kitchen, bathroom, exterior, etc.)
- Every piece of furniture: exact color, material, style
- Wall colors and any wall features (artwork, mirrors, shelving)
- Floor type and color (hardwood, tile, carpet, etc.)
- Ceiling height and any features (beams, lighting fixtures)
- All light sources (windows, overhead lights, lamps) and their positions
- Window details: how many, what views are visible outside
- Any architectural features (fireplace, built-ins, columns, etc.)
- Overall room dimensions/feel (cozy, spacious, etc.)

Be extremely specific. Start your response with: "A photorealistic real estate photograph of"`
            }
          ]
        }]
      })
    });

    if (!vResp.ok) {
      const err = await vResp.json();
      return res.status(vResp.status).json({ error: `GPT-4o error: ${err.error?.message || vResp.status}` });
    }
    const vData = await vResp.json();
    const description = vData.choices[0].message.content;

    // Step 2: DALL-E 3 — generate the edited version
    const styleText = STYLE_DESC[style] || STYLE_DESC.premium;
    const sizeMap = { '1792x1024': '1792x1024', '1024x1792': '1024x1792', '1024x1024': '1024x1024' };
    const dalleSize = sizeMap[size] || '1792x1024';

    const prompt = `${description}

EDITING INSTRUCTIONS: Apply ${styleText}.
STRICT RULES:
- Do NOT add any people, pets, or personal items
- Do NOT add furniture that wasn't in the original
- Do NOT remove any walls, windows, doors, or structural elements
- Fix any lens distortion or tilted lines
- This must look like a real photograph, not a rendering
- No watermarks, logos, or text overlays
- Output must be photorealistic professional real estate photography`;

    const gResp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        size: dalleSize,
        quality: 'hd',
        response_format: 'b64_json',
        n: 1
      })
    });

    if (!gResp.ok) {
      const err = await gResp.json();
      return res.status(gResp.status).json({ error: `DALL·E 3 error: ${err.error?.message || gResp.status}` });
    }
    const gData = await gResp.json();

    res.json({ b64: gData.data[0].b64_json });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
// Local dev: listen on port. Vercel: export the app.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Recluma Photo Editor running on port ${PORT}`));
}
module.exports = app;
