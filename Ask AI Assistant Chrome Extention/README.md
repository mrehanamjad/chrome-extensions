
# Ask AI — Chrome Extension

A premium, context-aware browser extension that brings powerful AI directly to your workflow. Designed with a focus on minimalism, speed, and privacy, this assistant seamlessly integrates with the web pages, you are actively reading, providing instant summaries, explanations, and insights without breaking your focus and answer your questions related to the content you are reading.

![UI Preview](https://via.placeholder.com/800x450/f8fafc/0f172a?text=Floating+Glassmorphic+UI+Preview)

## ✨ Key Features

*   **Bring Your Own Provider:** Complete flexibility to use the AI of your choice. Supports blazing-fast cloud APIs including **OpenRouter**, **Groq**, **OpenAI**, and **Google Gemini** or **custom** local models using **Ollama**.
*   **100% Local Privacy:** Deep, native integration with local **Ollama** models. Run powerful models entirely on your own hardware with zero data leaving your machine.
*   **Real-Time Streaming:** Enjoy fluid, instant responses with SSE (Server-Sent Events) and NDJSON stream parsing for a premium, typewriter-style chat experience.
*   **Intelligent Context Awareness:** The assistant automatically reads page metadata and your highlighted text, ensuring every answer is perfectly relevant to what you are looking at.
*   **Minimalist Design System:** A distraction-free, glassmorphic floating interface featuring soft layered shadows, precise typography, and a professional aesthetic.

---

## 🚀 Installation (Developer Preview)

Currently, the extension is loaded locally as an unpacked developer extension.

1. Clone this repository to your local machine:
   ```bash
   git clone [https://github.com/yourusername/ask-ai-extension.git](https://github.com/yourusername/ask-ai-extension.git)
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top right corner.
4. Click the **Load unpacked** button in the top left.
5. Select the cloned folder (where the `manifest.json` is located).
6. **Crucial for PDFs:** On the extension card, click **Details** and toggle on **Allow access to file URLs**.

---

## ⚙️ Configuration & Troubleshooting

Click the extension icon in your Chrome toolbar or the Settings (⚙️) icon in the chat UI to configure your models. Keys are securely stored locally in your browser.

### Using Cloud APIs (OpenRouter, Groq, OpenAI, Gemini)
Select your preferred provider from the dropdown, choose a curated model (or enter a custom model string exactly as the provider expects), and paste your API key. 

### Using Local Ollama
To use local models, you must grant Ollama permission to communicate with the browser extension via CORS (Cross-Origin Resource Sharing).

**Linux (Systemd):**
1. Open the service override editor: 
   ```bash
   sudo systemctl edit ollama.service
   ```
2. Add the following lines at the top of the file:
   ```ini
   [Service]
   Environment="OLLAMA_ORIGINS=*"
   
```
3. Save, exit, and restart the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

**macOS / Windows:**
Set the environment variable before starting the Ollama application or CLI.
*   **Mac:** `export OLLAMA_ORIGINS="*"`
*   **Windows:** `set OLLAMA_ORIGINS="*"`

*Note: Ensure you have pulled the model you intend to use (e.g., `ollama run llama3.2:3b`) before requesting it in the extension.*

---

## 💡 Usage Guide

*   **The Floating Toolbar:** Highlight any text on a webpage or PDF. A subtle floating toolbar will appear near your cursor. Click "✨ Ask AI" to open the chat with the text pre-loaded as context.
*   **Persistent Memory:** The chat window maintains a sliding-window memory of your recent conversation turns, allowing for natural, contextual follow-up questions on the same page.
*   **Draggable UI:** Grab the header of the chat window to drag and reposition it anywhere on your screen.

---

## 🛠️ Technical Architecture

*   **Platform:** Manifest V3 API standards.
*   **Stack:** Vanilla JavaScript, HTML5, CSS3. Zero heavy UI frameworks injected into the DOM, ensuring maximum browser performance.
*   **Communication:** Utilizes background service workers with long-lived `chrome.runtime.connect` ports to securely process API streams outside of the main browser thread.
*   **Rendering:** Implements `marked.js` and `highlight.js` for beautifully rendered markdown and syntax-highlighted code blocks.

---

### Author
Designed and engineered by **M. Rehan Amjad**
```