# Cantonese Gemini Chat

This project is now a static HTML/CSS/JavaScript chatbot that can be pushed to GitHub and deployed on Vercel without a backend.

Each visitor enters their own Gemini API key in the browser. The key is stored only in that user's local browser storage and requests go directly from the browser to the Gemini API.

## Features

- Pure static frontend: `index.html`, `styles.css`, `app.js`
- Hong Kong Cantonese system prompt using Traditional Chinese
- User-supplied Gemini API key
- Gemini 3.1 Flash TTS preview for generated speech playback
- Works well for GitHub + Vercel deployment
- No server or environment variables required

## Local run

1. Install dependencies:
   `npm install`
2. Start the local site:
   `npm run dev`

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Deploy with the default Vite settings.

No environment variable is needed because each user enters their own Gemini API key.

## Speech

The site now uses `gemini-3.1-flash-tts-preview` to generate audio for assistant replies.

Important: Google's official TTS docs state that TTS models accept text-only input and produce audio-only output, so this project still uses a separate chat model for text replies and `gemini-3.1-flash-tts-preview` for speech generation.

Note: Google's current TTS documentation explicitly lists Mandarin Chinese support, but does not explicitly list Cantonese. The app still prompts for Hong Kong Cantonese delivery, but speech output should be treated as best-effort.

## Gemini key

Users can create their own API key here:

https://aistudio.google.com/app/apikey
