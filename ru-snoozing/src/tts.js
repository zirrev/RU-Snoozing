import fs from 'fs';
import 'dotenv/config';
import axios from 'axios';
import player from 'play-sound';

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = 'TX3LPaxmHKxFdv7VOQHJ';
const text = "bhavyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function main() {
  try {
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

    fs.writeFileSync('output.mp3', response.data);
    console.log('✅ Audio file saved as output.mp3');

    // Play it
    const play = player({});
    play.play('output.mp3', function (err) {
      if (err) console.error('❌ Error playing audio:', err);
      else console.log('🔊 Playing audio...');
    });
  } catch (err) {
    console.error('❌ Error generating speech:', err.response?.data || err);
  }
}

main();