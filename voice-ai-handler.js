const OpenAI = require('openai');
const GoogleTTSHandler = require('./google-tts-handler');
const ElevenLabsHandler = require('./elevenlabs-handler');

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
    
    this.conversations = new Map();
  }

  isConfigured() {
    return this.openai !== null;
  }

  /**
   * System prompt - Operator telefonic UMAN cu vocea Kasya
   */
  getSystemPrompt() {
    return `ROL: Operator telefonic UMAN (femeie) la SuperParty, firmă evenimente copii.

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
[DATA: {"date": "...", "location": "...", "eventType": "...", "package": "...", "price": "..."}]
Când ai toate informațiile, adaugă [COMPLETE]`;
  }

  /**
   * Process conversation with GPT-4o
   */
  async processConversation(callSid, userMessage) {
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
        conversation = {
          messages: [
            { role: 'system', content: this.getSystemPrompt() },
            { role: 'assistant', content: 'Bună ziua, SuperParty, cu ce vă ajut?' }
          ],
          data: {}
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
          conversation.data = { ...conversation.data, ...extractedData };
        } catch (e) {
          console.error('[VoiceAI] Failed to parse data:', e);
        }
      }

      if (assistantMessage.includes('[COMPLETE]')) {
        completed = true;
        reservationData = conversation.data;
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
