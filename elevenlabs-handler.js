const https = require('https');
const fs = require('fs');
const path = require('path');

class ElevenLabsHandler {
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || 'sk_2e63b1cacac373135a1dfc97d6165ef184d0d66a181f74fc';
    this.voiceId = 'QtObtrglHRaER8xlDZsr';
    this.cacheDir = path.join(__dirname, 'cache');
    
    // Create cache directory
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async generateSpeech(text) {
    if (!this.isConfigured()) {
      console.log('[ElevenLabs] API key missing');
      return null;
    }

    try {
      // Generate cache filename
      const hash = require('crypto').createHash('md5').update(text).digest('hex');
      const filename = `${hash}.mp3`;
      const filepath = path.join(this.cacheDir, filename);

      // Check cache
      if (fs.existsSync(filepath)) {
        console.log('[ElevenLabs] Cache hit');
        return `/cache/${filename}`;
      }

      console.log('[ElevenLabs] Generating speech...');
      console.log('[ElevenLabs] Text:', text);
      console.log('[ElevenLabs] Voice ID:', this.voiceId);
      console.log('[ElevenLabs] API Key:', this.apiKey.substring(0, 15) + '...');

      const postData = JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.7,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
          speaking_rate: 1.0
        }
      });
      
      console.log('[ElevenLabs] Request body:', postData.substring(0, 100));

      const audioData = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.elevenlabs.io',
          path: `/v1/text-to-speech/${this.voiceId}`,
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json; charset=utf-8',
            'xi-api-key': this.apiKey,
            'Content-Length': Buffer.byteLength(postData, 'utf8')
          }
        }, (res) => {
          console.log('[ElevenLabs] Response status:', res.statusCode);
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              const buffer = Buffer.concat(chunks);
              console.log('[ElevenLabs] Success! Audio size:', buffer.length, 'bytes');
              resolve(buffer);
            } else {
              const errorBody = Buffer.concat(chunks).toString();
              console.error('[ElevenLabs] Error response:', errorBody);
              reject(new Error(`ElevenLabs API error: ${res.statusCode} - ${errorBody}`));
            }
          });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      // Save to cache
      fs.writeFileSync(filepath, audioData);
      console.log('[ElevenLabs] Speech generated and cached');

      return `/cache/${filename}`;

    } catch (error) {
      console.error('[ElevenLabs] Error:', error.message);
      return null;
    }
  }
}

module.exports = ElevenLabsHandler;
