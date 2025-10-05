from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai
import os
import subprocess
import shutil

# 1️⃣ Load environment variables
load_dotenv()

# 2️⃣ Configure Gemini API
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# 3️⃣ Initialize Flask
app = Flask(__name__)
CORS(app)  # allow requests from frontend

# 4️⃣ Storage for latest interaction
latest_interaction = {"text": None, "response": None}

# 5️⃣ Test route
@app.route("/")
def home():
    return "Flask backend is running ✅"

# 6️⃣ Gemini route — handles text input from frontend
@app.route("/gemini", methods=["POST"])
def gemini_response():
    data = request.get_json()
    user_text = data.get("text", "").strip()

    if not user_text:
        return jsonify({"error": "No text provided"}), 400

    try:
        print(f"\n🟢 New Input Received: {user_text}\n")

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

        # Resolve path to ru-snoozing/src/tts.js (server.py is in backend/)
        base_dir = os.path.dirname(os.path.dirname(__file__))  # go up from backend/ → ru-snoozing/
        tts_path = os.path.join(base_dir, "src", "tts.js")

        print("Resolved TTS path:", tts_path)
        print("TTS path exists?", os.path.exists(tts_path))

        if not os.path.exists(tts_path):
            err_msg = "tts.js not found at expected location. Check path."
            print(err_msg)
            return jsonify({"error": err_msg}), 500

        # Find node executable
        node_exec = shutil.which("node")
        # fallback common mac/linux locations
        if not node_exec:
            for candidate in ("/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node"):
                if os.path.exists(candidate):
                    node_exec = candidate
                    break

        print("Resolved node executable:", node_exec)
        if not node_exec:
            err_msg = "Node.js executable not found. Make sure 'node' is installed and available to the Flask process."
            print(err_msg)
            return jsonify({"error": err_msg}), 500

        # --- Run Node script and capture stdout/stderr so you can see console.log() from tts.js ---
        try:
            # use run to wait and capture output for debugging
            result = subprocess.run(
                [node_exec, tts_path, gemini_output],
                capture_output=True,
                text=True,
                timeout=60  # seconds; adjust if needed
            )
            print("----- node stdout -----")
            print(result.stdout)
            print("----- node stderr -----")
            print(result.stderr)
            print("----- node exit code -----")
            print(result.returncode)
            if result.returncode != 0:
                print("Node script exited non-zero. Check stderr above.")
        except subprocess.TimeoutExpired as te:
            print("Node process timed out:", te)
        except Exception as e:
            print("Error running node:", e)

        # Save latest interaction
        latest_interaction["text"] = user_text
        latest_interaction["response"] = gemini_output

        print(f"💬 Gemini Response: {gemini_output}\n")

        return jsonify({
            "message": "✅ Received text successfully!",
            "input": user_text,
            "response": gemini_output
        })

    except Exception as e:
        print("❌ Error:", e)
        return jsonify({"error": str(e)}), 500


# 7️⃣ Retrieve last stored response
@app.route("/latest", methods=["GET"])
def get_latest():
    if not latest_interaction["response"]:
        return jsonify({"message": "No previous interaction yet."}), 404
    return jsonify(latest_interaction)

# 8️⃣ Run the server
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)