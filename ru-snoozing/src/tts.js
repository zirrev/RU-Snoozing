import fs from 'fs';
import 'dotenv/config';
import axios from 'axios';
import player from 'play-sound';
import { promisify } from 'util';

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = 'TX3LPaxmHKxFdv7VOQHJ';

console.log("🎤 TTS script started");
console.log("API Key present:", !!apiKey);

// Get text from command-line argument
const text = process.argv[2];

if (!text) {
  console.error("❌ No text provided as argument");
  process.exit(1);
}

console.log("📝 Text to convert:", text);

async function main() {
  try {
    // Generate speech
    console.log("🔄 Calling ElevenLabs API...");
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_monolingual_v1',
      },
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
      }
    );

    // Save audio file
    const outputPath = 'output.mp3';
    fs.writeFileSync(outputPath, response.data);
    console.log('✅ Audio file saved as output.mp3');

    // Play audio and wait for completion
    console.log('🔊 Starting audio playback...');
    const audioPlayer = player({});
    
    // Promisify the play function to use async/await
    const playAudio = promisify(audioPlayer.play.bind(audioPlayer));
    
    try {
      await playAudio(outputPath);
      console.log('✅ Audio playback completed');
    } catch (playErr) {
      console.error('❌ Error playing audio:', playErr);
      process.exit(1);
    }

    // Clean exit
    process.exit(0);

  } catch (err) {
    console.error('❌ Error generating speech:');
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', err.response.data?.toString());
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }
}

main();