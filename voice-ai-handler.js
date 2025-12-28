const OpenAI = require('openai');
const GoogleTTSHandler = require('./google-tts-handler');
const ElevenLabsHandler = require('./elevenlabs-handler');
const FirebaseHandler = require('./firebase-handler');
const fs = require('fs');
const path = require('path');

class VoiceAIHandler {
  constructor() {
    this.openai = null;
    
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      console.log('[VoiceAI] Initialized with OpenAI');
    } else {
      console.warn('[VoiceAI] OpenAI API key missing - Voice AI disabled');
    }
    
    // Initialize TTS handlers (priority: ElevenLabs > Google TTS > Polly)
    this.elevenLabs = new ElevenLabsHandler();
    this.googleTTS = new GoogleTTSHandler();
    
    if (this.elevenLabs.isConfigured()) {
      console.log('[VoiceAI] ✅ ElevenLabs TTS enabled (PREMIUM VOICE)');
    } else if (this.googleTTS.isConfigured()) {
      console.log('[VoiceAI] ✅ Google Cloud TTS enabled');
    } else {
      console.log('[VoiceAI] ⚠️ Using Polly fallback (basic voice)');
    }
    
    // Initialize Firebase (priority over local JSON)
    this.firebase = new FirebaseHandler();
    
    this.conversations = new Map();
    this.clientsFile = path.join(__dirname, 'clients.json');
    this.clients = this.loadClients();
  }
  
  loadClients() {
    try {
      if (fs.existsSync(this.clientsFile)) {
        const data = fs.readFileSync(this.clientsFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('[VoiceAI] Error loading clients:', error);
    }
    return {};
  }
  
  saveClients() {
    try {
      fs.writeFileSync(this.clientsFile, JSON.stringify(this.clients, null, 2));
    } catch (error) {
      console.error('[VoiceAI] Error saving clients:', error);
    }
  }
  
  async getClientName(phoneNumber) {
    // Try Firebase first
    if (this.firebase.isConfigured()) {
      const clientData = await this.firebase.getClient(phoneNumber);
      return clientData?.name || null;
    }
    
    // Fallback to local JSON
    return this.clients[phoneNumber] || null;
  }
  
  async saveClientName(phoneNumber, name) {
    // Save to Firebase
    if (this.firebase.isConfigured()) {
      await this.firebase.saveClient(phoneNumber, { name });
    }
    
    // Also save to local JSON as backup
    this.clients[phoneNumber] = name;
    this.saveClients();
    console.log('[VoiceAI] Saved client:', phoneNumber, '->', name);
  }
  
  async getClientData(phoneNumber) {
    if (this.firebase.isConfigured()) {
      return await this.firebase.getClient(phoneNumber);
    }
    return null;
  }

  isConfigured() {
    return this.openai !== null;
  }

  /**
   * System prompt - Operator telefonic UMAN cu vocea Kasya
   */
  getSystemPrompt(clientContext = null) {
    // Context temporal pentru înțelegerea datelor relative
    const now = new Date();
    const days = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
    const months = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 
                    'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
    
    const currentDay = days[now.getDay()];
    const currentDate = now.getDate();
    const currentMonth = months[now.getMonth()];
    const currentYear = now.getFullYear();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes().toString().padStart(2, '0');
    
    // Calculez datele relative
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = days[tomorrow.getDay()];
    const tomorrowDate = tomorrow.getDate();
    const tomorrowMonth = months[tomorrow.getMonth()];
    
    const dayAfterTomorrow = new Date(now);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    const dayAfterDay = days[dayAfterTomorrow.getDay()];
    const dayAfterDate = dayAfterTomorrow.getDate();
    const dayAfterMonth = months[dayAfterTomorrow.getMonth()];
    
    let prompt = `ROL: Operator telefonic UMAN (femeie) la SuperParty, firmă evenimente copii.

CONTEXT TEMPORAL:
Astăzi este ${currentDay}, ${currentDate} ${currentMonth} ${currentYear}, ora ${currentHour}:${currentMinute}.
Mâine este ${tomorrowDay}, ${tomorrowDate} ${tomorrowMonth}.
Poimâine este ${dayAfterDay}, ${dayAfterDate} ${dayAfterMonth}.

Când clientul spune "azi", "mâine", "poimâine", "ieri", "săptămâna viitoare", folosești datele exacte de mai sus.

${clientContext ? '\n' + clientContext + '\n' : ''}

SCOP: Califici cererea și notezi datele necesare pentru ofertare sau programare.

REGULI CRITICE:
1. ❌ Nu menționa AI/bot/asistent virtual
2. ✅ Maxim 1 propoziție + 1 întrebare per răspuns
3. ✅ Cere informații UNA câte UNA
4. ✅ Dacă refuză opțiune: "Am înțeles." și mergi mai departe
5. ✅ Răspunzi doar la ceea ce cere clientul
6. ✅ Ton calm și prietenos, ca operator real

ZONĂ: București, Ilfov și până la 150 km de București.
Dacă e în afara zonei: "Momentan nu acoperim zona respectivă."

DESCHIDERE (alege UNA):
- "Bună ziua, SuperParty, cu ce vă ajut?"
- "Bună ziua, SuperParty, spuneți."
- "Bună ziua, SuperParty."

CONFIRMĂRI SCURTE (variază):
- "Perfect."
- "Bun."
- "Am notat."
- "În regulă."
- "Am înțeles."

CALIFICARE (UNA PE RÂND):
1) Pentru ce dată e evenimentul?
2) În ce localitate?
3) E zi de naștere, grădiniță sau alt eveniment?

DACĂ ESTE ZI DE NAȘTERE:
4) Cum îl cheamă pe sărbătorit?
5) Ce vârstă împlinește?
6) Câți copii aproximativ?
7) Cam cât să țină: 1 oră, 2 ore sau altceva?
8) Vreți animator simplu sau și un personaj?

PACHETE DISPONIBILE:
SUPER 1 - 1 Personaj 2 ore – 490 lei
SUPER 2 - 2 Personaje 1 oră – 490 lei (Luni-Vineri)
SUPER 3 - 2 Personaje 2 ore + Confetti party – 840 lei (CEL MAI POPULAR)
SUPER 4 - 1 Personaj 1 oră + Tort dulciuri – 590 lei
SUPER 5 - 1 Personaj 2 ore + Vată + Popcorn – 840 lei
SUPER 6 - 1 Personaj 2 ore + Banner + Tun confetti + Lumânare – 540 lei
SUPER 7 - 1 Personaj 3 ore + Spectacol 4 ursitoare botez – 1290 lei

CÂND ÎNTREABĂ DESPRE PACHETE/PREȚ:
❌ NU enumera toate pachetele!
✅ Pune întrebări pentru a afla ce vrea:
1) "Pentru câte ore vă gândiți?"
2) "Doriți un personaj sau doi?"
3) "Vă interesează ceva în plus: confetti party, vată și popcorn, sau tort?"
4) Oferi UN SINGUR pachet potrivit

CONFIRMARE FINALĂ:
"Perfect! Am notat [data] în [locație], [tip eveniment], [pachet] la [preț] lei. Vă sun înapoi cu confirmare în cel mai scurt timp. Mulțumesc și o zi bună!"

TRACKING:
Ține evidența informațiilor în format JSON:
[DATA: {"date": "...", "location": "...", "eventType": "...", "childName": "...", "childAge": "...", "childBirthDate": "...", "package": "...", "price": "...", "services": [...]}]
Când ai toate informațiile, adaugă [COMPLETE]`;
    
    return prompt;
  }

  /**
   * Process conversation with GPT-4o
   */
  async processConversation(callSid, userMessage, phoneNumber = null) {
    if (!this.openai) {
      return {
        response: 'Ne pare rău, serviciul Voice AI nu este disponibil momentan.',
        audioUrl: null,
        completed: true,
        data: null
      };
    }
    
    try {
      // Get or create conversation
      let conversation = this.conversations.get(callSid);
      
      if (!conversation) {
        // Get client data from Firebase
        const clientData = phoneNumber ? await this.getClientData(phoneNumber) : null;
        const clientName = clientData?.name || (phoneNumber ? await this.getClientName(phoneNumber) : null);
        
        // Build intelligent context
        const clientContext = clientData ? this.firebase.buildClientContext(clientData) : null;
        
        let greeting = 'Bună ziua, SuperParty, cu ce vă ajut?';
        
        if (clientName) {
          greeting = `Bună ziua ${clientName}, SuperParty, cu ce vă pot ajuta?`;
          console.log('[VoiceAI] Returning client:', clientName, phoneNumber);
        }
        
        conversation = {
          messages: [
            { role: 'system', content: this.getSystemPrompt(clientContext) },
            { role: 'assistant', content: greeting }
          ],
          data: {},
          phoneNumber: phoneNumber,
          clientData: clientData
        };
        this.conversations.set(callSid, conversation);
      }

      // Add user message
      conversation.messages.push({
        role: 'user',
        content: userMessage
      });

      // Call GPT-4o
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: conversation.messages,
        temperature: 0.7,
        max_tokens: 150
      });

      const assistantMessage = response.choices[0].message.content;

      // Add to history
      conversation.messages.push({
        role: 'assistant',
        content: assistantMessage
      });

      // Extract data
      let completed = false;
      let reservationData = null;

      const dataMatch = assistantMessage.match(/\[DATA:\s*({[^}]+})\]/);
      if (dataMatch) {
        try {
          const extractedData = JSON.parse(dataMatch[1]);
          
          // Calculate birthDate from age if not provided
          if (extractedData.childAge && !extractedData.childBirthDate && extractedData.date) {
            const eventDate = new Date(extractedData.date);
            const birthYear = eventDate.getFullYear() - parseInt(extractedData.childAge);
            extractedData.childBirthDate = `${birthYear}-01-01`; // Approximate
          }
          
          conversation.data = { ...conversation.data, ...extractedData };
        } catch (e) {
          console.error('[VoiceAI] Failed to parse data:', e);
        }
      }

      if (assistantMessage.includes('[COMPLETE]')) {
        completed = true;
        reservationData = conversation.data;
        
        // Save to Firebase
        if (conversation.phoneNumber && this.firebase.isConfigured()) {
          const clientName = reservationData.clientName || conversation.clientData?.name || 'Unknown';
          
          // Save/update client
          await this.firebase.saveClient(conversation.phoneNumber, {
            name: clientName
          });
          
          // Add child if provided
          if (reservationData.childName && reservationData.childBirthDate) {
            const clientData = await this.firebase.getClient(conversation.phoneNumber);
            const children = clientData?.children || [];
            
            // Check if child already exists
            const existingChild = children.find(c => c.name === reservationData.childName);
            if (!existingChild) {
              children.push({
                name: reservationData.childName,
                birthDate: reservationData.childBirthDate
              });
              
              await this.firebase.saveClient(conversation.phoneNumber, {
                name: clientName,
                children: children
              });
            }
          }
          
          // Save event
          await this.firebase.saveEvent(conversation.phoneNumber, {
            date: reservationData.date,
            location: reservationData.location,
            eventType: reservationData.eventType,
            childName: reservationData.childName,
            childAge: reservationData.childAge,
            package: reservationData.package,
            price: reservationData.price,
            services: reservationData.services || []
          });
          
          console.log('[VoiceAI] ✅ Saved to Firebase:', conversation.phoneNumber);
        }
      }
      
      // Detect and save client name from user message
      if (conversation.phoneNumber && userMessage) {
        const namePatterns = [
          /(?:m[ăa] (?:cheam[ăa]|numesc)|numele meu (?:e|este))\s+([A-ZĂÎÂȘȚ][a-zăîâșț]+)/i,
          /^([A-ZĂÎÂȘȚ][a-zăîâșț]+)$/,
          /sunt\s+([A-ZĂÎÂȘȚ][a-zăîâșț]+)/i
        ];
        
        for (const pattern of namePatterns) {
          const match = userMessage.match(pattern);
          if (match && match[1]) {
            const name = match[1];
            const existingName = await this.getClientName(conversation.phoneNumber);
            if (name.length >= 3 && !existingName) {
              await this.saveClientName(conversation.phoneNumber, name);
              break;
            }
          }
        }
      }

      // Clean response
      const cleanResponse = assistantMessage
        .replace(/\[DATA:.*?\]/g, '')
        .replace(/\[COMPLETE\]/g, '')
        .trim();

      // Generate audio with priority: ElevenLabs > Google TTS > Polly
      let audioUrl = null;
      
      if (this.elevenLabs.isConfigured()) {
        audioUrl = await this.elevenLabs.generateSpeech(cleanResponse);
        if (audioUrl) {
          console.log('[VoiceAI] 🎤 Using ElevenLabs (PREMIUM)');
        }
      }
      
      if (!audioUrl && this.googleTTS.isConfigured()) {
        audioUrl = await this.googleTTS.generateSpeech(cleanResponse);
        if (audioUrl) {
          console.log('[VoiceAI] 🎤 Using Google TTS');
        }
      }
      
      if (!audioUrl) {
        console.log('[VoiceAI] ⚠️ Using Polly fallback');
      }

      return {
        response: cleanResponse,
        audioUrl,
        completed,
        data: reservationData
      };

    } catch (error) {
      console.error('[VoiceAI] Error:', error);
      return {
        response: 'Ne pare rău, am întâmpinat o problemă tehnică. Vă rugăm să sunați din nou.',
        audioUrl: null,
        completed: true,
        data: null
      };
    }
  }

  /**
   * End conversation
   */
  endConversation(callSid) {
    const conversation = this.conversations.get(callSid);
    this.conversations.delete(callSid);
    return conversation;
  }
}

module.exports = VoiceAIHandler;
