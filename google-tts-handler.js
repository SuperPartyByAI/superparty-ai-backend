const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class GoogleTTSHandler {
  constructor() {
    this.client = null;
    this.cacheDir = path.join(__dirname, 'cache');
    
    // Create cache directory
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    // Initialize client if credentials available
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS_JSON) {
      try {
        if (process.env.GOOGLE_CREDENTIALS_JSON) {
          const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
          this.client = new textToSpeech.TextToSpeechClient({ credentials });
        } else {
          this.client = new textToSpeech.TextToSpeechClient();
        }
        console.log('[GoogleTTS] Initialized');
      } catch (error) {
        console.log('[GoogleTTS] Init failed:', error.message);
      }
    }
  }

  isConfigured() {
    return !!this.client;
  }

  async generateSpeech(text) {
    if (!this.isConfigured()) {
      console.log('[GoogleTTS] Not configured');
      return null;
    }

    try {
      // Generate cache filename
      const hash = crypto.createHash('md5').update(text).digest('hex');
      const filename = `${hash}.mp3`;
      const filepath = path.join(this.cacheDir, filename);

      // Check cache
      if (fs.existsSync(filepath)) {
        console.log('[GoogleTTS] Cache hit');
        return `/cache/${filename}`;
      }

      console.log('[GoogleTTS] Generating speech...');

      const request = {
        input: { text: text },
        voice: {
          languageCode: 'ro-RO',
          name: 'ro-RO-Wavenet-A', // Female, natural voice
          ssmlGender: 'FEMALE'
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 0.95,
          pitch: 2.0,
          effectsProfileId: ['telephony-class-application']
        }
      };

      const [response] = await this.client.synthesizeSpeech(request);

      // Save to cache
      fs.writeFileSync(filepath, response.audioContent, 'binary');
      console.log('[GoogleTTS] Speech generated and cached');

      return `/cache/${filename}`;

    } catch (error) {
      console.error('[GoogleTTS] Error:', error.message);
      return null;
    }
  }
}

module.exports = GoogleTTSHandler;
