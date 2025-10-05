import os
import requests
from dotenv import load_dotenv
from playsound import playsound

load_dotenv()
api_key = os.getenv("ELEVENLABS_API_KEY")
voice_id = "TX3LPaxmHKxFdv7VOQHJ"

def text_to_speech(text: str) -> str:
    """
    Generate speech from text using ElevenLabs API.
    Saves to output.mp3 and plays it.
    Returns the file path of the saved MP3.
    """
    try:
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "text": text,
            "model_id": "eleven_monolingual_v1"
        }

        response = requests.post(url, headers=headers, json=payload)

        if response.status_code != 200:
            print("❌ Error generating speech:", response.text)
            return ""

        # Save to backend/output.mp3
        output_file = os.path.join(os.path.dirname(__file__), "output.mp3")
        with open(output_file, "wb") as f:
            f.write(response.content)

        print("✅ Audio file saved as output.mp3")

        # Play audio locally
        playsound(output_file)
        print("🔊 Playing audio...")

        return output_file

    except Exception as e:
        print("❌ Error:", e)
        return ""
