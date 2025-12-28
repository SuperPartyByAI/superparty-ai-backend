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
        const greeting = 'Bună ziua, SuperParty, cu ce vă ajut?';
        
        // Try to get audio from Coqui
        let audioUrl = null;
        if (this.voiceAI.coqui?.isConfigured()) {
          audioUrl = await this.voiceAI.coqui.generateSpeech(greeting);
        }
        
        if (audioUrl) {
          // Use Kasya voice from Coqui
          const fullUrl = `${process.env.COQUI_API_URL || 'https://web-production-00dca9.up.railway.app'}${audioUrl}`;
          twiml.play(fullUrl);
        } else {
          // Fallback to Polly
          twiml.say({
            voice: 'Polly.Carmen',
            language: 'ro-RO'
          }, greeting);
        }
        
        // Gather speech input
        const gather = twiml.gather({
          input: 'speech',
          language: 'ro-RO',
          speechTimeout: 'auto',
          action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
          method: 'POST'
        });
        
      } else if (SpeechResult) {
        // Process user input
        const result = await this.voiceAI.processConversation(CallSid, SpeechResult);
        
        if (result.completed) {
          // Conversation complete
          if (result.audioUrl) {
            const fullUrl = `${process.env.COQUI_API_URL || 'https://web-production-00dca9.up.railway.app'}${result.audioUrl}`;
            twiml.play(fullUrl);
          } else {
            twiml.say({
              voice: 'Polly.Carmen',
              language: 'ro-RO'
            }, result.response);
          }
          
          twiml.hangup();
          
          // Clean up
          this.voiceAI.endConversation(CallSid);
          this.activeCalls.delete(CallSid);
          
        } else {
          // Continue conversation
          if (result.audioUrl) {
            const fullUrl = `${process.env.COQUI_API_URL || 'https://web-production-00dca9.up.railway.app'}${result.audioUrl}`;
            twiml.play(fullUrl);
          } else {
            twiml.say({
              voice: 'Polly.Carmen',
              language: 'ro-RO'
            }, result.response);
          }
          
          // Gather next input
          const gather = twiml.gather({
            input: 'speech',
            language: 'ro-RO',
            speechTimeout: 'auto',
            action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
            method: 'POST'
          });
        }
      } else {
        // No input - repeat
        twiml.say({
          voice: 'Polly.Carmen',
          language: 'ro-RO'
        }, 'Nu am primit nicio informație. Vă rog să repetați.');
        
        const gather = twiml.gather({
          input: 'speech',
          language: 'ro-RO',
          speechTimeout: 'auto',
          action: `${process.env.BACKEND_URL}/api/voice/ai-conversation`,
          method: 'POST'
        });
      }

      res.type('text/xml');
      res.send(twiml.toString());
      
    } catch (error) {
      console.error('[Twilio] Error in AI conversation:', error);
      
      const twiml = new VoiceResponse();
      twiml.say({
        voice: 'Polly.Carmen',
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
