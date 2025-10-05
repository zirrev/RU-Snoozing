from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai
import os
import subprocess
import shutil
import sys

# Load environment variables
load_dotenv()

# Configure Gemini API
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Initialize Flask
app = Flask(__name__)
CORS(app)

# Storage for latest interaction
latest_interaction = {"text": None, "response": None}

@app.route("/")
def home():
    return "Flask backend is running ✅"

@app.route("/gemini", methods=["POST"])
def gemini_response():
    data = request.get_json()
    user_text = data.get("text", "").strip()

    if not user_text:
        return jsonify({"error": "No text provided"}), 400

    try:
        print(f"\n🟢 New Input Received: {user_text}\n", flush=True)

        # Prompt for Gemini
        prompt = f"""
You are a voice assistant. The user gives a short intent like "pep talk", "scary voice", or "motivation".
Reply as a voice assistant with exactly two short, natural sentences that match the tone.
It must sound human and spoken — not robotic.
Generate your response based on this intent: "{user_text}"
Examples:
pep talk → "Come on, you've got this! Don't quit now."
scary voice → "If you sleep now, something's watching. Stay awake."
motivation → "Every second counts. Keep pushing."
The output should ultimately be motivational and to keep the user awake.
"""

        # Generate response from Gemini
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(prompt)
        gemini_output = response.text.strip()

        print(f"💬 Gemini Response: {gemini_output}\n", flush=True)

        # Resolve path to tts.js
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        tts_path = os.path.join(base_dir, "src", "tts.js")

        print(f"📂 Base directory: {base_dir}", flush=True)
        print(f"📂 TTS path: {tts_path}", flush=True)
        print(f"📂 TTS exists: {os.path.exists(tts_path)}", flush=True)

        if not os.path.exists(tts_path):
            return jsonify({"error": f"tts.js not found at: {tts_path}"}), 500

        # Find node executable
        node_exec = shutil.which("node")
        if not node_exec:
            # Try common paths
            for candidate in ["/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node"]:
                if os.path.exists(candidate):
                    node_exec = candidate
                    break

        print(f"🔧 Node executable: {node_exec}", flush=True)
        
        if not node_exec:
            return jsonify({"error": "Node.js not found. Install Node.js."}), 500

        # Run Node script
        print(f"🎬 Starting TTS generation...", flush=True)
        
        # Pass environment variables to Node process
        env = os.environ.copy()
        env['ELEVENLABS_API_KEY'] = os.getenv('ELEVENLABS_API_KEY', '')
        
        try:
            result = subprocess.run(
                [node_exec, tts_path, gemini_output],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=base_dir,  # Set working directory for output.mp3
                env=env  # Pass environment variables
            )
            
            print("=" * 50, flush=True)
            print("📤 NODE STDOUT:", flush=True)
            print(result.stdout, flush=True)
            print("=" * 50, flush=True)
            print("📤 NODE STDERR:", flush=True)
            print(result.stderr, flush=True)
            print("=" * 50, flush=True)
            print(f"📤 NODE EXIT CODE: {result.returncode}", flush=True)
            print("=" * 50, flush=True)
            
            if result.returncode != 0:
                print("⚠️ Node script exited with error", flush=True)
                return jsonify({
                    "error": "TTS generation failed",
                    "details": result.stderr
                }), 500

        except subprocess.TimeoutExpired:
            print("⏱️ Node process timed out", flush=True)
            return jsonify({"error": "TTS generation timed out"}), 500
        except Exception as e:
            print(f"❌ Error running node: {e}", flush=True)
            return jsonify({"error": f"Failed to run TTS: {str(e)}"}), 500

        # Save latest interaction
        latest_interaction["text"] = user_text
        latest_interaction["response"] = gemini_output

        print(f"✅ Request completed successfully\n", flush=True)

        return jsonify({
            "message": "✅ Received text successfully!",
            "input": user_text,
            "response": gemini_output,
            "tts_status": "completed"
        })

    except Exception as e:
        print(f"❌ Error in gemini_response: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/latest", methods=["GET"])
def get_latest():
    if not latest_interaction["response"]:
        return jsonify({"message": "No previous interaction yet."}), 404
    return jsonify(latest_interaction)

if __name__ == "__main__":
    print("🚀 Starting Flask server...", flush=True)
    print(f"📂 Current directory: {os.getcwd()}", flush=True)
    print(f"📂 Script directory: {os.path.dirname(os.path.abspath(__file__))}", flush=True)
    app.run(host="0.0.0.0", port=5001, debug=True)