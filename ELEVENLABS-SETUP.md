# 🎤 ElevenLabs Setup - Voce REALĂ ca o persoană

## De ce ElevenLabs?

ElevenLabs oferă cea mai naturală voce AI din lume:
- ✅ Sună EXACT ca o persoană reală
- ✅ Suportă română perfect
- ✅ Emoții și intonație naturală
- ✅ FREE tier: 10,000 caractere/lună (suficient pentru ~100 apeluri)

## Pasul 1: Creează cont ElevenLabs

1. Mergi la: https://elevenlabs.io
2. Click **Sign Up** (FREE)
3. Confirmă email-ul

## Pasul 2: Obține API Key

1. Login la https://elevenlabs.io
2. Click pe profilul tău (dreapta sus)
3. Click **Profile + API Key**
4. Copiază API Key-ul

## Pasul 3: Adaugă pe Railway

1. Mergi la Railway Dashboard
2. Selectează serviciul `web-production-f0714`
3. Click **Variables**
4. Click **New Variable**
5. Adaugă:
   ```
   ELEVENLABS_API_KEY=<api-key-ul-tau>
   ```
6. Click **Add**

Railway va redeploy automat în ~2 minute.

## Pasul 4: Testează

Sună la: **+1 (218) 220-4425**

Ar trebui să auzi vocea Kasya care sună EXACT ca o persoană reală!

## Verificare

Verifică că funcționează:
```bash
curl https://web-production-f0714.up.railway.app/
```

Ar trebui să vezi:
```json
{
  "voice": "ElevenLabs (PREMIUM)"
}
```

## Costuri

- **FREE**: 10,000 caractere/lună
- **Starter**: $5/lună - 30,000 caractere
- **Creator**: $22/lună - 100,000 caractere

Un apel mediu = ~100 caractere
FREE tier = ~100 apeluri/lună

## Voce folosită

- **Voice ID**: `EXAVITQu4vr4xnSDxMaL` (Sarah)
- **Model**: `eleven_multilingual_v2` (suportă română)
- **Setări**:
  - Stability: 0.5 (natural)
  - Similarity: 0.75 (consistent)
  - Style: 0.5 (expresiv)
  - Speaker Boost: ON (claritate)

## Troubleshooting

**Dacă nu funcționează:**

1. Verifică că API key-ul e corect
2. Verifică că ai caractere disponibile în cont
3. Verifică logs în Railway pentru erori
4. Dacă ElevenLabs e down, va folosi automat Polly fallback

**Logs:**
```
[VoiceAI] ✅ ElevenLabs TTS enabled (PREMIUM VOICE)
[Voice] ✅ Using ElevenLabs (PREMIUM VOICE)
```
