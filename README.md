# Recluma — AI Real Estate Photo Editor

Your OpenAI key is stored **server-side only** as an environment variable.
It is never sent to the browser, never visible in page source, never logged.

## Deploy in 2 minutes (Vercel)

```bash
cd recluma-backend
npm install
npx vercel --yes
```

When prompted, or right after deploying, set your environment variable:

```bash
npx vercel env add OPENAI_API_KEY
```

Paste your OpenAI key when prompted, select "Production", then redeploy:

```bash
npx vercel --prod --yes
```

That's it — you'll get a live URL. Open it, upload photos, no key entry needed
in the browser at all.

## Run locally first (optional, to test)

```bash
npm install
export OPENAI_API_KEY=sk-proj-your-key-here
npm start
```

Then open http://localhost:3000

## How the security works

- `server.js` reads `OPENAI_API_KEY` from the environment — never from the frontend
- `public/index.html` has NO API key field — it just uploads photos to `/api/process-photo`
- The server makes the OpenAI calls and returns only the edited image
- Your key never touches the browser, network tab, or page source
