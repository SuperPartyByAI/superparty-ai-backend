# 🔐 SuperParty AI - Ghid Credențiale

## 📋 Index

1. [OpenAI API](#openai-api)
2. [Twilio](#twilio)
3. [ElevenLabs](#elevenlabs)
4. [Google Cloud TTS](#google-cloud-tts)
5. [Firebase](#firebase)
6. [Railway Deployment](#railway-deployment)

---

## 🤖 OpenAI API

**Ce face:** GPT-4o pentru conversații inteligente cu clienții

**Unde obții:**
1. Mergi la: https://platform.openai.com/api-keys
2. Click **"Create new secret key"**
3. Nume: `SuperParty AI`
4. Copiază cheia (începe cu `sk-proj-...`)

**Variabile:**
```bash
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Cost:** ~$0.01 per conversație (150 tokens × $0.00006/token)

---

## 📞 Twilio

**Ce face:** Sistem telefonic pentru apeluri

**Unde obții:**
1. Mergi la: https://console.twilio.com/
2. Dashboard → **Account Info**
3. Copiază:
   - **Account SID** (începe cu `AC...`)
   - **Auth Token** (click pe 👁️ pentru a vedea)
4. Phone Numbers → Numărul tău activ

**Variabile:**
```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1218220xxxx
```

**Cost:** 
- Număr: $1/lună
- Apeluri: $0.013/min (incoming) + $0.014/min (outgoing)

---

## 🎙️ ElevenLabs

**Ce face:** Text-to-Speech premium (vocea Kasya)

**Unde obții:**
1. Mergi la: https://elevenlabs.io/app/settings/api-keys
2. Click **"Create API Key"**
3. Copiază cheia (începe cu `sk_...`)
4. Pentru Voice ID:
   - Mergi la: https://elevenlabs.io/app/voice-library
   - Găsește vocea dorită
   - Click → Copiază **Voice ID**

**Variabile:**
```bash
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ELEVENLABS_VOICE_ID=QtObtrglHRaER8xlDZsr
```

**Voice ID-uri disponibile:**
- `QtObtrglHRaER8xlDZsr` - Vocea actuală
- `EXAVITQu4vr4xnSDxMaL` - Sarah (alternativă)

**Cost:** 10,000 caractere/lună gratuit, apoi $5/100k caractere

---

## 🗣️ Google Cloud TTS

**Ce face:** Fallback pentru voice (dacă ElevenLabs nu merge)

**Unde obții:**
1. Mergi la: https://console.cloud.google.com/apis/credentials
2. Click **"Create Credentials"** → **"Service Account"**
3. Nume: `superparty-tts`
4. Role: **Cloud Text-to-Speech User**
5. Click **"Done"**
6. Click pe service account creat
7. Tab **"Keys"** → **"Add Key"** → **"Create new key"**
8. Alege **JSON**
9. Descarcă fișierul
10. Deschide fișierul și copiază ÎNTREG conținutul

**Variabile:**
```bash
GOOGLE_APPLICATION_CREDENTIALS={"type":"service_account","project_id":"...","private_key":"..."}
```

**Cost:** 1 milion caractere/lună gratuit, apoi $4/1M caractere

---

## 🔥 Firebase

**Ce face:** Database pentru clienți, copii, evenimente

**Unde obții:**

### Pasul 1: Activează Firestore
1. Mergi la: https://console.firebase.google.com/project/superparty-frontend/firestore
2. Click **"Create database"**
3. Alege **"Start in production mode"**
4. Location: **"europe-west"**
5. Click **"Enable"**

### Pasul 2: Generează Service Account Key
1. Mergi la: https://console.firebase.google.com/project/superparty-frontend/settings/serviceaccounts/adminsdk
2. Click **"Generate new private key"**
3. Click **"Generate key"**
4. Descarcă fișierul JSON
5. Deschide și copiază ÎNTREG conținutul

**Variabile:**
```bash
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"superparty-frontend",...}
FIREBASE_DATABASE_URL=https://superparty-frontend.firebaseio.com
```

### Pasul 3: Firebase CLI Token (pentru deploy)
```bash
firebase login:ci
```
Copiază token-ul generat:
```bash
FIREBASE_TOKEN=1//09oPpQMhUwueNCgYIARAAGAkSNwF-L9Ir...
```

**Cost:** 
- Spark Plan (GRATUIT):
  - 50,000 reads/zi
  - 20,000 writes/zi
  - 1GB storage
- Suficient pentru ~500 clienți activi/lună

---

## 🚂 Railway Deployment

**Unde adaugi variabilele:**
1. Mergi la: https://railway.app
2. Selectează proiectul **superparty-ai-backend**
3. Click tab **"Variables"**
4. Click **"+ New Variable"** pentru fiecare

**Variabile necesare:**
```bash
BACKEND_URL=https://web-production-f0714.up.railway.app
OPENAI_API_KEY=sk-proj-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1218220xxxx
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=QtObtrglHRaER8xlDZsr
GOOGLE_APPLICATION_CREDENTIALS={"type":"service_account",...}
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
FIREBASE_DATABASE_URL=https://superparty-frontend.firebaseio.com
```

**⚠️ NU adăuga:**
- `PORT` (Railway setează automat)
- `NODE_ENV` (Railway setează automat)

---

## 🔒 Securitate

### ✅ Bune practici:

1. **Nu commita niciodată .env în Git**
   ```bash
   # Verifică .gitignore
   echo ".env" >> .gitignore
   ```

2. **Rotește cheile periodic** (la 3-6 luni)

3. **Folosește variabile separate pentru dev/prod**

4. **Monitorizează usage-ul** pentru a detecta abuse

### ❌ Nu face:

- Nu pune credențiale în cod
- Nu share-ui credențiale pe chat/email
- Nu folosești aceleași credențiale pentru dev și prod

---

## 🧪 Verificare Credențiale

Rulează script-ul de verificare:

```bash
node verify-credentials.js
```

Output așteptat:
```
✅ OpenAI API: Connected
✅ Twilio: Connected
✅ ElevenLabs: Connected
✅ Google Cloud TTS: Connected
✅ Firebase: Connected
```

---

## 📞 Support

Dacă ai probleme:
1. Verifică că toate variabilele sunt setate corect
2. Verifică că nu ai spații extra în valori
3. Verifică că JSON-urile sunt valide (folosește jsonlint.com)
4. Verifică logs în Railway pentru erori specifice

---

## 📊 Cost Total Estimat

**Lunar (pentru ~100 apeluri/lună):**
- Twilio: $1 (număr) + $2.70 (apeluri) = **$3.70**
- OpenAI: $1 (100 conversații) = **$1.00**
- ElevenLabs: **$0** (sub limita gratuită)
- Google Cloud: **$0** (sub limita gratuită)
- Firebase: **$0** (sub limita gratuită)
- Railway: **$5** (hosting)

**TOTAL: ~$10/lună**

Pentru 1000 apeluri/lună: ~$40/lună
