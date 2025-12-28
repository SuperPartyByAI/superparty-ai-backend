# 🚀 SuperParty AI - Setup Complet

## 📋 Pași Rapizi

```bash
# 1. Clonează repo
git clone https://github.com/SuperPartyByAI/superparty-ai-backend.git
cd superparty-ai-backend

# 2. Instalează dependințe
npm install

# 3. Configurează credențiale
cp .env.example .env
nano .env  # Completează toate valorile

# 4. Verifică credențiale
npm run verify

# 5. Pornește serverul
npm start
```

---

## 📦 Fișiere Importante

```
superparty-ai-backend/
├── .env.example          # Template pentru credențiale
├── .env                  # Credențialele tale (NU commita!)
├── CREDENTIALS.md        # Ghid detaliat pentru fiecare credențială
├── SETUP.md             # Acest fișier
├── verify-credentials.js # Script verificare
├── server.js            # Server principal
├── voice-ai-handler.js  # AI conversații
├── twilio-handler.js    # Twilio integration
├── elevenlabs-handler.js # ElevenLabs TTS
├── firebase-handler.js  # Firebase CRM
└── package.json         # Dependencies
```

---

## 🔧 Configurare Locală

### 1. Creează fișierul .env

```bash
cp .env.example .env
```

### 2. Completează credențialele

Deschide `.env` și completează:

```bash
# CRITICAL (obligatorii)
BACKEND_URL=http://localhost:3000
OPENAI_API_KEY=sk-proj-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1218220xxxx

# OPTIONAL (recomandate)
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=QtObtrglHRaER8xlDZsr
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

Vezi [CREDENTIALS.md](./CREDENTIALS.md) pentru detalii despre fiecare.

### 3. Verifică configurația

```bash
npm run verify
```

Output așteptat:
```
✅ OpenAI: Connected
✅ Twilio: Connected
✅ ElevenLabs: Connected
✅ Firebase: Connected
```

### 4. Pornește serverul

```bash
npm start
```

Server pornește pe: http://localhost:3000

---

## 🚂 Deploy pe Railway

### 1. Conectează GitHub

1. Mergi la: https://railway.app
2. Click **"New Project"**
3. Alege **"Deploy from GitHub repo"**
4. Selectează `superparty-ai-backend`

### 2. Adaugă variabile

Click **"Variables"** și adaugă:

```bash
BACKEND_URL=https://[your-railway-url].up.railway.app
OPENAI_API_KEY=sk-proj-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1218220xxxx
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=QtObtrglHRaER8xlDZsr
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

### 3. Deploy

Railway face auto-deploy la fiecare push pe `main`.

### 4. Configurează Twilio Webhook

1. Mergi la: https://console.twilio.com/
2. Phone Numbers → Numărul tău
3. Voice Configuration:
   - **A CALL COMES IN:** Webhook
   - **URL:** `https://[your-railway-url].up.railway.app/api/voice/incoming`
   - **HTTP:** POST

---

## 🧪 Testare

### Test Local

```bash
# Terminal 1: Pornește serverul
npm start

# Terminal 2: Test endpoint
curl http://localhost:3000/health
```

### Test Twilio

1. Sună numărul: **+1 (218) 220-4425**
2. Verifică logs în Railway
3. Verifică date în Firebase Console

---

## 📊 Monitorizare

### Railway Logs

```bash
# Vezi logs live
railway logs
```

Sau în browser: https://railway.app/project/[id]/deployments

### Firebase Console

Vezi datele clienților:
https://console.firebase.google.com/project/superparty-frontend/firestore/data

### Twilio Logs

Vezi apelurile:
https://console.twilio.com/monitor/logs/calls

---

## 🔍 Debugging

### Problema: "OpenAI API key invalid"

```bash
# Verifică cheia
echo $OPENAI_API_KEY

# Testează manual
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Problema: "Twilio authentication failed"

```bash
# Verifică credențialele
echo $TWILIO_ACCOUNT_SID
echo $TWILIO_AUTH_TOKEN

# Testează manual
curl -X GET "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID.json" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"
```

### Problema: "ElevenLabs 422 error"

```bash
# Verifică encoding UTF-8
# Problema: Content-Length calculat greșit pentru caractere românești
# Soluție: Folosește Buffer.byteLength(text, 'utf8')
```

### Problema: "Firebase not initialized"

```bash
# Verifică JSON-ul
echo $FIREBASE_SERVICE_ACCOUNT | jq .

# Verifică că are toate câmpurile
# - type: "service_account"
# - project_id
# - private_key
# - client_email
```

---

## 📚 Resurse

- **OpenAI Docs:** https://platform.openai.com/docs
- **Twilio Docs:** https://www.twilio.com/docs/voice
- **ElevenLabs Docs:** https://elevenlabs.io/docs
- **Firebase Docs:** https://firebase.google.com/docs/firestore
- **Railway Docs:** https://docs.railway.app

---

## 🆘 Support

Dacă ai probleme:

1. **Verifică logs:** `railway logs` sau Railway dashboard
2. **Rulează verificare:** `npm run verify`
3. **Verifică .env:** Toate variabilele sunt setate?
4. **Verifică JSON:** Credențialele Firebase/Google sunt JSON valid?

---

## 🔄 Update

```bash
# Pull latest changes
git pull origin main

# Install new dependencies
npm install

# Restart server
npm restart
```

---

## 📝 Scripts Disponibile

```bash
npm start          # Pornește serverul
npm run dev        # Development mode (cu nodemon)
npm run verify     # Verifică credențiale
npm test           # Rulează teste (TODO)
```

---

## 🎯 Next Steps

După setup:

1. ✅ Testează apelul telefonic
2. ✅ Verifică că vocea merge (ElevenLabs)
3. ✅ Verifică că datele se salvează în Firebase
4. ✅ Testează client recurent (al 2-lea apel)
5. ✅ Monitorizează costuri în dashboards

---

## 💰 Costuri Estimate

**Pentru ~100 apeluri/lună:**
- Twilio: $3.70
- OpenAI: $1.00
- ElevenLabs: $0 (gratuit)
- Firebase: $0 (gratuit)
- Railway: $5.00

**TOTAL: ~$10/lună**

Vezi [CREDENTIALS.md](./CREDENTIALS.md) pentru detalii.
