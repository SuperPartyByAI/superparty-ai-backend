const https = require('https');
const fs = require('fs');
const path = require('path');

class ElevenLabsHandler {
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    this.voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah - natural female voice
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

      const postData = JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true
        }
      });

      const audioData = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.elevenlabs.io',
          path: `/v1/text-to-speech/${this.voiceId}`,
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
            'Content-Length': postData.length
          }
        }, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(Buffer.concat(chunks));
            } else {
              reject(new Error(`ElevenLabs API error: ${res.statusCode}`));
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
