const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim().replace(/[^A-Za-z0-9_-]+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mkbqwbekgkpkevdhzjof.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const STYLE_DESC = {
  premium: 'professional premium real estate photography with perfect color grading, natural daylight white balance, balanced exposure showing both interior details and window views, clean and inviting atmosphere',
  bright:  'bright and airy real estate photography with lifted shadows, clean neutral-white walls, abundant natural light, modern fresh feel',
  warm:    'warm and cozy real estate photography with golden-hour tones, enhanced wood textures, soft inviting lighting, homey atmosphere',
  dramatic:'dramatic luxury real estate photography with rich deep shadows, high contrast, architectural emphasis, editorial magazine quality'
};

async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_SERVICE_KEY }
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    return user && user.id ? user : null;
  } catch (e) { return null; }
}

async function supabaseRpc(fnName, args) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify(args)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Database error');
  return data;
}

app.post('/api/me', async (req, res) => {
  const user = await getUserFromToken(req.body.token);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=email,credits,is_admin`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const rows = await resp.json();
    if (!rows || rows.length === 0) {
      return res.json({ email: user.email, credits: 5, is_admin: user.email === 'info@recluma.com' });
    }
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/process-photo', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Server not configured with OpenAI key.' });
  const { imageB64, style, size, token } = req.body;
  if (!imageB64) return res.status(400).json({ error: 'imageB64 is required' });

  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Please sign in to edit photos.' });

  let remaining;
  try {
    remaining = await supabaseRpc('deduct_credit', { p_user_id: user.id });
  } catch (e) {
    return res.status(500).json({ error: 'Credit check failed: ' + e.message });
  }
  if (remaining === -1) {
    return res.status(402).json({ error: 'Out of credits. Contact the admin to add more.' });
  }

  const refund = async () => {
    try { await supabaseRpc('admin_add_credits', { p_admin_id: user.id, p_target_email: user.email, p_amount: 1 }); } catch(e){}
  };

  try {
    const vResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o', max_tokens: 800,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}`, detail: 'high' } },
          { type: 'text', text: 'You are a real estate photography expert. Describe this property photo in precise detail for photorealistic recreation. Include room type, every piece of furniture (color, material, style), wall colors, flooring, ceiling features, all light sources and windows, architectural features, and overall feel. Be extremely specific. Start with: "A photorealistic real estate photograph of"' }
        ]}]
      })
    });
    if (!vResp.ok) {
      const err = await vResp.json();
      await refund();
      return res.status(vResp.status).json({ error: `GPT-4o error: ${err.error?.message || vResp.status}` });
    }
    const vData = await vResp.json();
    const description = vData.choices[0].message.content;

    const styleText = STYLE_DESC[style] || STYLE_DESC.premium;
    const sizeMap = { '1792x1024': '1792x1024', '1024x1792': '1024x1792', '1024x1024': '1024x1024' };
    const dalleSize = sizeMap[size] || '1792x1024';

    const prompt = `${description}\n\nEDITING INSTRUCTIONS: Apply ${styleText}.\nSTRICT RULES:\n- Do NOT add people, pets, or personal items\n- Do NOT add furniture that was not in the original\n- Do NOT remove walls, windows, doors, or structural elements\n- Fix lens distortion and tilted lines\n- Photorealistic, no watermarks, no text`;

    const gResp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, size: dalleSize, quality: 'hd', response_format: 'b64_json', n: 1 })
    });
    if (!gResp.ok) {
      const err = await gResp.json();
      await refund();
      return res.status(gResp.status).json({ error: `DALL·E 3 error: ${err.error?.message || gResp.status}` });
    }
    const gData = await gResp.json();
    res.json({ b64: gData.data[0].b64_json, creditsRemaining: remaining });
  } catch (e) {
    await refund();
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/users', async (req, res) => {
  const user = await getUserFromToken(req.body.token);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const data = await supabaseRpc('admin_list_users', { p_admin_id: user.id });
    res.json({ users: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/add-credits', async (req, res) => {
  const user = await getUserFromToken(req.body.token);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const { email, amount } = req.body;
  if (!email || !amount) return res.status(400).json({ error: 'email and amount required' });
  try {
    const newBalance = await supabaseRpc('admin_add_credits', {
      p_admin_id: user.id, p_target_email: email, p_amount: parseInt(amount)
    });
    if (newBalance === -1) return res.status(403).json({ error: 'Not authorized or user not found' });
    res.json({ newBalance });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Recluma running on port ${PORT}`));
}
module.exports = app;
