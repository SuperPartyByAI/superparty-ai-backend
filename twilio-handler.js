const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

class TwilioHandler {
  constructor(voiceAI) {
    this.voiceAI = voiceAI;
    this.activeCalls = new Map();
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
    
    // Wait for 3 rings before answering (approximately 9 seconds)
    // Each ring is about 3 seconds
    twiml.pause({ length: 9 });
    
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
      const { CallSid, From, SpeechResult, initial } = req.body;
      
      const twiml = new VoiceResponse();
      
      if (initial === 'true') {
        // First message - greeting
        const greetingText = 'Bună ziua! Numele meu este Kasya, de la SuperParty. Cu ce vă pot ajuta?';
        
        // Try to get audio from Google TTS
        let audioUrl = null;
        if (this.voiceAI.googleTTS?.isConfigured()) {
          audioUrl = await this.voiceAI.googleTTS.generateSpeech(greetingText);
        }
        
        const gather = twiml.gather({
          input: 'speech',
          language: 'ro-RO',
          speechTimeout: 4,
          timeout: 6,
          action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
          method: 'POST'
        });
        
        if (audioUrl) {
          // Use Google TTS audio (natural voice)
          console.log('[Voice] Using Google Cloud TTS (natural voice)');
          const fullUrl = `${process.env.BACKEND_URL}${audioUrl}`;
          gather.play(fullUrl);
        } else {
          // Fallback to Google Wavenet (more natural than Polly)
          console.log('[Voice] Using Google Wavenet fallback');
          gather.say({
            voice: 'Google.ro-RO-Wavenet-A',
            language: 'ro-RO'
          }, greetingText);
        }
        
        // Dacă nu vorbește după 6 secunde
        twiml.say({
          voice: 'Google.ro-RO-Wavenet-A',
          language: 'ro-RO'
        }, 'Vă ascult.');
        
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
              voice: 'Google.ro-RO-Wavenet-A',
              language: 'ro-RO'
            }, result.response);
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
            speechTimeout: 4,
            timeout: 6,
            action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
            method: 'POST'
          });
          
          if (result.audioUrl) {
            const fullUrl = `${process.env.BACKEND_URL}${result.audioUrl}`;
            gather.play(fullUrl);
          } else {
            gather.say({
              voice: 'Google.ro-RO-Wavenet-A',
              language: 'ro-RO'
            }, result.response);
          }
          
          // Dacă nu vorbește, repetă
          twiml.say({
            voice: 'Google.ro-RO-Wavenet-A',
            language: 'ro-RO'
          }, 'Vă ascult.');
        }
      } else {
        // No input - repeat
        const gather = twiml.gather({
          input: 'speech',
          language: 'ro-RO',
          speechTimeout: 3,
          timeout: 5,
          action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
          method: 'POST'
        });
        
        gather.say({
          voice: 'Google.ro-RO-Wavenet-A',
          language: 'ro-RO'
        }, 'Vă rog să repetați.');
        
        twiml.say({
          voice: 'Google.ro-RO-Wavenet-A',
          language: 'ro-RO'
        }, 'Vă ascult.');
      }

      res.type('text/xml');
      res.send(twiml.toString());
      
    } catch (error) {
      console.error('[Twilio] Error in AI conversation:', error);
      
      const twiml = new VoiceResponse();
      twiml.say({
        voice: 'Google.ro-RO-Wavenet-A',
        language: 'ro-RO'
      }, 'Ne pare rău, a apărut o eroare. Vă rugăm să sunați din nou.');
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
