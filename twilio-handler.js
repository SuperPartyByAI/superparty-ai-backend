const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

class TwilioHandler {
  constructor(voiceAI) {
    this.voiceAI = voiceAI;
    this.activeCalls = new Map();
  }

  /**
   * Wrap text in SSML for more natural Polly voice
   */
  makeNaturalVoice(text) {
    return `<speak><prosody rate="95%" pitch="+2st" volume="medium">${text}</prosody></speak>`;
  }

  /**
   * Handle incoming call
   */
  handleIncomingCall(req, res) {
    const { CallSid, From, To } = req.body;

    console.log('[Twilio] Incoming call:', { callSid: CallSid, from: From });

    this.activeCalls.set(CallSid, {
      callId: CallSid,
      from: From,
      to: To,
      status: 'ringing',
      createdAt: new Date().toISOString()
    });

    const twiml = new VoiceResponse();
    
    // Wait for 2 rings before answering (6 seconds)
    twiml.pause({ length: 6 });
    
    // Direct to AI conversation
    twiml.redirect({
      method: 'POST'
    }, `${process.env.BACKEND_URL}/api/voice/ai-conversation?CallSid=${CallSid}&From=${From}&initial=true`);

    res.type('text/xml');
    res.send(twiml.toString());
  }

  /**
   * Handle AI conversation
   */
  async handleAIConversation(req, res) {
    try {
      // Get params from both query and body (Twilio sends in both)
      const CallSid = req.body.CallSid || req.query.CallSid;
      const From = req.body.From || req.query.From;
      const SpeechResult = req.body.SpeechResult;
      const initial = req.query.initial || req.body.initial;
      
      console.log('[Twilio] AI Conversation called:', { CallSid, From, initial, SpeechResult: SpeechResult?.substring(0, 30) });
      
      const twiml = new VoiceResponse();
      
      if (initial === 'true') {
        // Initialize conversation with greeting
        const greetingText = 'Bună ziua! Numele meu este Kasya, de la SuperParty. Cu ce vă pot ajuta?';
        
        // Initialize conversation in VoiceAI
        this.voiceAI.conversations.set(CallSid, {
          messages: [
            { role: 'system', content: this.voiceAI.getSystemPrompt() },
            { role: 'assistant', content: greetingText }
          ],
          data: {}
        });
        
        // Try to get audio with priority: ElevenLabs > Google TTS
        let audioUrl = null;
        
        if (this.voiceAI.elevenLabs?.isConfigured()) {
          console.log('[Voice] Attempting ElevenLabs TTS...');
          audioUrl = await this.voiceAI.elevenLabs.generateSpeech(greetingText);
          if (audioUrl) {
            console.log('[Voice] ✅ Using ElevenLabs (PREMIUM VOICE)');
          } else {
            console.log('[Voice] ❌ ElevenLabs failed');
          }
        }
        
        if (!audioUrl && this.voiceAI.googleTTS?.isConfigured()) {
          console.log('[Voice] Attempting Google Cloud TTS...');
          audioUrl = await this.voiceAI.googleTTS.generateSpeech(greetingText);
          if (audioUrl) {
            console.log('[Voice] ✅ Using Google Cloud TTS');
          } else {
            console.log('[Voice] ❌ Google Cloud TTS failed');
          }
        }
        
        if (!audioUrl) {
          console.log('[Voice] ⚠️ Using Polly fallback with SSML');
        }
        
        const gather = twiml.gather({
          input: 'speech',
          language: 'ro-RO',
          speechTimeout: 'auto',
          timeout: 5,
          action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
          method: 'POST'
        });
        
        if (audioUrl) {
          // Use Google TTS audio (natural voice)
          const fullUrl = `${process.env.BACKEND_URL}${audioUrl}`;
          gather.play(fullUrl);
        } else {
          // Fallback to Amazon Polly with SSML for more natural voice
          console.log('[Voice] Using Amazon Polly with SSML');
          const ssmlGreeting = `<speak><prosody rate="95%" pitch="+2st" volume="medium">${greetingText}</prosody></speak>`;
          gather.say({
            voice: 'Polly.Carmen',
            language: 'ro-RO'
          }, ssmlGreeting);
        }
        
      } else if (SpeechResult) {
        // Process user input
        const result = await this.voiceAI.processConversation(CallSid, SpeechResult);
        
        if (result.completed) {
          // Conversation complete
          if (result.audioUrl) {
            const fullUrl = `${process.env.BACKEND_URL}${result.audioUrl}`;
            twiml.play(fullUrl);
          } else {
            twiml.say({
              voice: 'Polly.Carmen',
              language: 'ro-RO'
            }, this.makeNaturalVoice(result.response));
          }
          
          twiml.hangup();
          
          // Clean up
          this.voiceAI.endConversation(CallSid);
          this.activeCalls.delete(CallSid);
          
        } else {
          // Continue conversation
          const gather = twiml.gather({
            input: 'speech',
            language: 'ro-RO',
            speechTimeout: 'auto',
            timeout: 5,
            action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
            method: 'POST'
          });
          
          if (result.audioUrl) {
            const fullUrl = `${process.env.BACKEND_URL}${result.audioUrl}`;
            gather.play(fullUrl);
          } else {
            gather.say({
              voice: 'Polly.Carmen',
              language: 'ro-RO'
            }, this.makeNaturalVoice(result.response));
          }
        }
      } else {
        // No input - prompt again
        const gather = twiml.gather({
          input: 'speech',
          language: 'ro-RO',
          speechTimeout: 'auto',
          timeout: 5,
          action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
          method: 'POST'
        });
        
        gather.say({
          voice: 'Polly.Carmen',
          language: 'ro-RO'
        }, this.makeNaturalVoice('Cu ce vă pot ajuta?'));
      }

      res.type('text/xml');
      res.send(twiml.toString());
      
    } catch (error) {
      console.error('[Twilio] Error in AI conversation:', error);
      
      const twiml = new VoiceResponse();
      twiml.say({
        voice: 'Polly.Carmen',
        language: 'ro-RO'
      }, this.makeNaturalVoice('Ne pare rău, a apărut o eroare. Vă rugăm să sunați din nou.'));
      twiml.hangup();
      
      res.type('text/xml');
      res.send(twiml.toString());
    }
  }

  /**
   * Handle IVR response (not used, direct to AI)
   */
  handleIVRResponse(req, res) {
    const twiml = new VoiceResponse();
    twiml.redirect({
      method: 'POST'
    }, `${process.env.BACKEND_URL}/api/voice/ai-conversation?initial=true`);
    
    res.type('text/xml');
    res.send(twiml.toString());
  }

  /**
   * Handle call status
   */
  handleCallStatus(req, res) {
    const { CallSid, CallStatus, CallDuration } = req.body;

    console.log('[Twilio] Call status:', { callSid: CallSid, status: CallStatus });

    const callData = this.activeCalls.get(CallSid);
    if (callData) {
      callData.status = CallStatus;
      callData.duration = parseInt(CallDuration) || 0;

      if (CallStatus === 'completed' || CallStatus === 'failed') {
        this.activeCalls.delete(CallSid);
      }
    }

    res.sendStatus(200);
  }

  /**
   * Get active calls
   */
  getActiveCalls() {
    return Array.from(this.activeCalls.values());
  }
}

module.exports = TwilioHandler;
