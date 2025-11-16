# TTS Quick Start Guide

## 🚀 5-Minute Setup

### Step 1: Apply Database Migration
```bash
cd dm_app
pnpm db:push
```

### Step 2: Start the App
```bash
pnpm dev
```

### Step 3: Configure TTS
1. Click Settings ⚙️ (top-right)
2. Go to "Text-to-Speech" tab
3. Select:
   - Provider: **OpenAI TTS**
   - Model: **tts-1-hd** (best quality)
   - Voice: **onyx** or **nova** (popular choices)
   - API Key: Your OpenAI key
4. Click **Save Settings**

### Step 4: Test It!
1. Create a campaign and character (if you haven't already)
2. Send a message to the DM
3. Click the 🔊 icon next to DM's response
4. Enjoy your audio!

## 🎙️ Voice Recommendations

- **Dramatic DM**: Onyx (deep, commanding)
- **Friendly DM**: Alloy (neutral, clear)
- **Female DM**: Nova or Shimmer
- **British DM**: Fable
- **Male DM**: Echo

## 💰 Cost

Very affordable:
- ~$0.005 per DM message
- $0.50 for 100 messages
- About $15/month for heavy daily use

## ⚡ Features

✅ Play/stop controls
✅ Audio caching (instant replay)
✅ 2 quality levels (tts-1, tts-1-hd)
✅ 6 different voices
✅ Smart error handling

## 🔧 Troubleshooting

**No speaker icon?**
→ Check Settings, ensure API key is saved

**401 Error?**
→ Invalid API key, get new one from OpenAI

**429 Error?**
→ Rate limited, wait a minute or upgrade OpenAI tier

## 📚 More Info

- Full details: `TTS_IMPLEMENTATION.md`
- Testing guide: `TESTING_TTS.md`
- Summary: `TTS_SUMMARY.md`

---

**Ready to go!** The TTS feature is fully implemented and waiting for you to try it out. 🎲✨
