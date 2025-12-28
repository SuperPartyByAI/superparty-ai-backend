#!/usr/bin/env node

/**
 * SuperParty AI - Credentials Verification Script
 * Verifică că toate credențialele sunt setate corect
 */

require('dotenv').config();
const https = require('https');

const checks = [];

// Colors for terminal
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(status, service, message) {
  const icon = status === 'success' ? '✅' : status === 'error' ? '❌' : '⚠️';
  const color = status === 'success' ? colors.green : status === 'error' ? colors.red : colors.yellow;
  console.log(`${icon} ${color}${service}${colors.reset}: ${message}`);
}

// 1. Check OpenAI
async function checkOpenAI() {
  return new Promise((resolve) => {
    if (!process.env.OPENAI_API_KEY) {
      log('error', 'OpenAI', 'OPENAI_API_KEY not set');
      resolve(false);
      return;
    }

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/models',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200) {
        log('success', 'OpenAI', 'Connected successfully');
        resolve(true);
      } else {
        log('error', 'OpenAI', `Failed with status ${res.statusCode}`);
        resolve(false);
      }
    });

    req.on('error', (e) => {
      log('error', 'OpenAI', e.message);
      resolve(false);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      log('error', 'OpenAI', 'Timeout');
      resolve(false);
    });

    req.end();
  });
}

// 2. Check Twilio
async function checkTwilio() {
  return new Promise((resolve) => {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      log('error', 'Twilio', 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set');
      resolve(false);
      return;
    }

    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

    const options = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}.json`,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200) {
        log('success', 'Twilio', 'Connected successfully');
        resolve(true);
      } else {
        log('error', 'Twilio', `Failed with status ${res.statusCode}`);
        resolve(false);
      }
    });

    req.on('error', (e) => {
      log('error', 'Twilio', e.message);
      resolve(false);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      log('error', 'Twilio', 'Timeout');
      resolve(false);
    });

    req.end();
  });
}

// 3. Check ElevenLabs
async function checkElevenLabs() {
  return new Promise((resolve) => {
    if (!process.env.ELEVENLABS_API_KEY) {
      log('warning', 'ElevenLabs', 'ELEVENLABS_API_KEY not set (optional)');
      resolve(true);
      return;
    }

    const options = {
      hostname: 'api.elevenlabs.io',
      path: '/v1/user',
      method: 'GET',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200) {
        log('success', 'ElevenLabs', 'Connected successfully');
        resolve(true);
      } else {
        log('error', 'ElevenLabs', `Failed with status ${res.statusCode}`);
        resolve(false);
      }
    });

    req.on('error', (e) => {
      log('error', 'ElevenLabs', e.message);
      resolve(false);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      log('error', 'ElevenLabs', 'Timeout');
      resolve(false);
    });

    req.end();
  });
}

// 4. Check Google Cloud TTS
function checkGoogleCloud() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    log('warning', 'Google Cloud TTS', 'GOOGLE_APPLICATION_CREDENTIALS not set (optional)');
    return true;
  }

  try {
    const creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (creds.type === 'service_account' && creds.private_key && creds.client_email) {
      log('success', 'Google Cloud TTS', 'Credentials format valid');
      return true;
    } else {
      log('error', 'Google Cloud TTS', 'Invalid credentials format');
      return false;
    }
  } catch (e) {
    log('error', 'Google Cloud TTS', 'Invalid JSON: ' + e.message);
    return false;
  }
}

// 5. Check Firebase
function checkFirebase() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    log('warning', 'Firebase', 'FIREBASE_SERVICE_ACCOUNT not set (optional)');
    return true;
  }

  try {
    const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (creds.type === 'service_account' && creds.private_key && creds.project_id) {
      log('success', 'Firebase', `Credentials valid (project: ${creds.project_id})`);
      return true;
    } else {
      log('error', 'Firebase', 'Invalid credentials format');
      return false;
    }
  } catch (e) {
    log('error', 'Firebase', 'Invalid JSON: ' + e.message);
    return false;
  }
}

// 6. Check Environment Variables
function checkEnvVars() {
  const required = [
    'BACKEND_URL',
    'OPENAI_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER'
  ];

  const optional = [
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_VOICE_ID',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'FIREBASE_SERVICE_ACCOUNT',
    'FIREBASE_DATABASE_URL'
  ];

  console.log('\n' + colors.blue + '📋 Environment Variables:' + colors.reset);
  
  let allRequired = true;
  required.forEach(key => {
    if (process.env[key]) {
      log('success', key, 'Set');
    } else {
      log('error', key, 'NOT SET (required)');
      allRequired = false;
    }
  });

  optional.forEach(key => {
    if (process.env[key]) {
      log('success', key, 'Set');
    } else {
      log('warning', key, 'Not set (optional)');
    }
  });

  return allRequired;
}

// Main
async function main() {
  console.log(colors.blue + '🔐 SuperParty AI - Credentials Verification\n' + colors.reset);

  const envVarsOk = checkEnvVars();
  
  console.log('\n' + colors.blue + '🌐 API Connections:' + colors.reset);
  
  const openaiOk = await checkOpenAI();
  const twilioOk = await checkTwilio();
  const elevenLabsOk = await checkElevenLabs();
  const googleCloudOk = checkGoogleCloud();
  const firebaseOk = checkFirebase();

  console.log('\n' + colors.blue + '📊 Summary:' + colors.reset);
  
  const criticalOk = envVarsOk && openaiOk && twilioOk;
  
  if (criticalOk) {
    log('success', 'Status', 'All critical services configured ✅');
  } else {
    log('error', 'Status', 'Some critical services missing ❌');
  }

  if (elevenLabsOk) {
    log('success', 'Voice', 'Premium voice (ElevenLabs) enabled');
  } else if (googleCloudOk) {
    log('warning', 'Voice', 'Using Google Cloud TTS fallback');
  } else {
    log('warning', 'Voice', 'Using Polly fallback (basic voice)');
  }

  if (firebaseOk) {
    log('success', 'Database', 'Firebase CRM enabled');
  } else {
    log('warning', 'Database', 'Using local JSON fallback');
  }

  console.log('');
  process.exit(criticalOk ? 0 : 1);
}

main();
