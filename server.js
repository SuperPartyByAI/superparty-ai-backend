/**
 * SuperParty Voice AI Backend
 * Centrala telefonică cu vocea Kasya (Coqui XTTS)
 */

const express = require('express');
const cors = require('cors');
const VoiceAIHandler = require('./voice-ai-handler');
const TwilioHandler = require('./twilio-handler');

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize handlers
const voiceAI = new VoiceAIHandler();
const twilioHandler = new TwilioHandler(voiceAI);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'SuperParty Backend - WhatsApp + Voice',
    activeCalls: twilioHandler.getActiveCalls().length,
    voiceAI: voiceAI.isConfigured() ? 'enabled' : 'disabled',
    coqui: voiceAI.coqui?.isConfigured() ? 'enabled' : 'disabled'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'SuperParty Voice AI',
    timestamp: new Date().toISOString()
  });
});

// Voice AI Routes
app.post('/api/voice/incoming', (req, res) => {
  twilioHandler.handleIncomingCall(req, res);
});

app.post('/api/voice/ivr-response', (req, res) => {
  twilioHandler.handleIVRResponse(req, res);
});

app.post('/api/voice/ai-conversation', async (req, res) => {
  await twilioHandler.handleAIConversation(req, res);
});

app.post('/api/voice/status', (req, res) => {
  twilioHandler.handleCallStatus(req, res);
});

app.get('/api/voice/calls', (req, res) => {
  const calls = twilioHandler.getActiveCalls();
  res.json({ success: true, calls });
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  🚀 SuperParty Backend - WhatsApp + Voice             ║');
  console.log(`║  📡 Server running on port ${PORT}                       ║`);
  console.log('║  📞 Voice calls: Enabled                              ║');
  console.log('║  🎤 Voice: Kasya (Coqui XTTS)                         ║');
  console.log('║  ✅ Ready to accept connections                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY missing - Voice AI disabled');
  }
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.log('⚠️  TWILIO credentials missing');
  }
  if (!voiceAI.coqui?.isConfigured()) {
    console.log('⚠️  Coqui service not available - using fallback voice');
  }
  console.log('');
});

module.exports = app;
