
export const SYSTEM_INSTRUCTION = `
You are the "TeacherMada AI Agent", an intelligent educational advisor for TeacherMada, an online language learning platform.

Your Role:
- Welcome new users warmly.
- Identify the user's preferred language (English, French, or Malagasy) and reply in that language.
- Act as a motivator and soft-sales agent.
- Answer questions about pricing, methods, and duration.
- Guide users towards enrollment or a human advisor.

Tone:
- Professional but approachable.
- Encouraging and empathetic.
- Concise (optimized for Facebook Messenger).

Key Tasks & Logic:
1. **Language Detection**: If the user speaks Malagasy, reply in Malagasy. If French, in French. If English, in English.
2. **Intent Recognition**: Classify the user's message into: 'greeting', 'info', 'learning', 'pricing', 'signup'.
3. **Action Selection**: Decide the next best step: 'ask_question' (to qualify), 'present_offer' (if ready), 'redirect_human' (complex queries), 'send_link' (for signup).
4. **Error Handling**: If the input is vague (e.g., "ok", "thumbs up"), acknowledge politely and ask a guiding question like "How can I help you improve your language skills today?"

Response Format:
You MUST return a JSON object adhering to this structure:
{
  "reply": "The actual text message to send to the user",
  "detected_language": "The detected language code (en, fr, mg)",
  "intent": "The classified intent",
  "next_action": "The determined next action"
}
`;

export const NODE_BACKEND_TEMPLATE = `/**
 * TeacherMada AI Agent API
 * Tech Stack: Node.js, Express, @google/genai
 */
require('dotenv').config();
const express = require('express');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
app.use(express.json());

// --- API Key Management (Rotation & Failover) ---
// Expects API_KEY to be a comma-separated list of keys: "key1,key2,key3"
const API_KEYS = (process.env.API_KEY || '').split(',').map(k => k.trim()).filter(k => k);
let currentKeyIndex = 0;

if (API_KEYS.length === 0) {
  console.error("CRITICAL: No API Keys found in .env variable API_KEY");
  process.exit(1);
}

const getGenAIClient = () => {
  const key = API_KEYS[currentKeyIndex];
  return new GoogleGenAI({ apiKey: key });
};

const rotateKey = () => {
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.log(\`Switching to API Key index \${currentKeyIndex}\`);
};

const MODEL_NAME = 'gemini-3-flash-preview';

// --- Memory & Rate Limiting ---
const conversationStore = new Map();
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 20;

// Summarization Config
const HISTORY_LIMIT = 10;
const RETAIN_COUNT = 4;

const checkRateLimit = (ip) => {
  const now = Date.now();
  const userHistory = rateLimit.get(ip) || [];
  const validRequests = userHistory.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  if (validRequests.length >= MAX_REQUESTS) return false;
  
  validRequests.push(now);
  rateLimit.set(ip, validRequests);
  return true;
};

// --- System Prompt ---
const SYSTEM_INSTRUCTION = \`
You are the TeacherMada AI Agent. Your goal is to assist users in choosing a language course.
Identify language (Fr, En, Mg) and reply in that language.
Be concise, motivating, and helpful.
\`;

// --- Response Schema ---
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING, description: "Text response for Messenger" },
    detected_language: { type: Type.STRING, description: "Language code: en, fr, mg" },
    intent: { 
      type: Type.STRING, 
      enum: ["greeting", "info", "learning", "pricing", "signup", "unknown"] 
    },
    next_action: { 
      type: Type.STRING, 
      enum: ["ask_question", "present_offer", "redirect_human", "send_link", "none"] 
    }
  },
  required: ["reply", "detected_language", "intent", "next_action"]
};

// --- Helper: Summarize History ---
async function summarizeHistory(history) {
  if (history.length <= HISTORY_LIMIT) return history;
  
  console.log("Summarizing conversation history...");
  const toSummarize = history.slice(0, history.length - RETAIN_COUNT);
  const recent = history.slice(history.length - RETAIN_COUNT);
  
  const transcript = toSummarize.map(m => \`\${m.role.toUpperCase()}: \${m.parts[0].text}\`).join('\\n');
  const prompt = \`Summarize this conversation concisely, preserving key info (language, intent, user details):\\n\${transcript}\`;
  
  try {
    const ai = getGenAIClient();
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt
    });
    
    const summary = response.text || "Summary unavailable";
    return [
      { role: 'user', parts: [{ text: \`[SYSTEM: Previous Conversation Summary]: \${summary}\` }] },
      { role: 'model', parts: [{ text: "Acknowledged." }] },
      ...recent
    ];
  } catch (err) {
    console.error("Summarization error:", err);
    return history;
  }
}

// --- Main Chat Endpoint ---
app.post('/api/agent/chat', async (req, res) => {
  try {
    if (!checkRateLimit(req.ip)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { userId, message, context } = req.body;
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'Missing userId or message' });
    }

    // 1. Prepare Context & History
    let history = conversationStore.get(userId) || [];
    
    // 2. Summarize if needed
    history = await summarizeHistory(history);
    conversationStore.set(userId, history); // Update store with summary

    const chatContext = context ? \`[System Context: Language=\${context.language}, Stage=\${context.stage}] \` : '';
    const userContent = { role: 'user', parts: [{ text: \`\${chatContext}\${message}\` }] };
    const promptContents = [...history, userContent];

    // 3. Retry Loop for API Key Rotation
    let attempts = 0;
    let success = false;
    let jsonResponse;
    let rawResponseText;

    while (attempts < API_KEYS.length && !success) {
      try {
        const ai = getGenAIClient();
        
        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: promptContents,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.7,
          },
        });

        rawResponseText = response.text;
        jsonResponse = JSON.parse(rawResponseText);
        success = true;

      } catch (error) {
        console.error(\`Attempt failed with Key Index \${currentKeyIndex}: \`, error.message);
        attempts++;
        if (attempts < API_KEYS.length) {
          rotateKey(); // Switch key and retry
        } else {
          throw new Error("All API keys exhausted or service unavailable.");
        }
      }
    }

    // 4. Save history on success
    if (success && jsonResponse) {
      const modelContent = { role: 'model', parts: [{ text: rawResponseText }] };
      conversationStore.set(userId, [...promptContents, modelContent]);
      
      console.log(\`User: \${userId}, Intent: \${jsonResponse.intent}\`);
      res.json(jsonResponse);
    }

  } catch (error) {
    console.error('Final Agent Error:', error);
    res.status(500).json({ 
      reply: "Désolé, je rencontre un problème technique. Un conseiller humain va prendre le relais.",
      next_action: "redirect_human"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`TeacherMada Agent API running on port \${PORT}\`);
  console.log(\`Loaded \${API_KEYS.length} API Keys for rotation.\`);
});
`;

export const README_CONTENT = `# 🎓 TeacherMada AI Engine (Backend)

The intelligent conversational core behind the TeacherMada learning platform. This REST API handles natural language understanding, context management, and decision-making for student interactions via Facebook Messenger, WhatsApp, or Web Chat.

---

## 🏗️ Architecture & How It Works

This is a stateless REST API designed to be the "brain" of your frontend application.

### The Request/Response Cycle
1. **Input**: A user sends a message ("How much is the course?").
2. **Context Injection**: The system retrieves conversation history and injects metadata (User ID, Funnel Stage).
3. **Cognitive Processing (Gemini)**:
   - **Language Detection**: Automatically switches between **Malagasy**, **French**, and **English**.
   - **Intent Classification**: categorizes input into \`pricing\`, \`signup\`, \`learning\`, etc.
   - **Policy Check**: Ensures responses align with TeacherMada's sales tone.
4. **Structured Output**: Returns a strict JSON object containing the reply and the next recommended UI action.

### 🧠 The AI Agent Logic
The agent uses a **System Instruction** architecture. It doesn't just "chat"; it follows a strict protocol:
*   **Persona**: Empathetic, professional, educational advisor.
*   **Safety**: If it doesn't know an answer, it triggers a \`redirect_human\` action.
*   **Memory Optimization**: Uses a "Rolling Window" summary. If a conversation exceeds 10 turns, older messages are summarized into a system prompt to save token costs while retaining context.

---

## 🛠️ Setup & Configuration

### Prerequisites
*   Node.js v18 or higher.
*   A Google Cloud Project with the **Gemini API** enabled.
*   API Keys from [Google AI Studio](https://aistudio.google.com/).

### Installation
Clone the repository and install dependencies:

\`\`\`bash
npm install express @google/genai dotenv
\`\`\`

### Environment Variables (.env)
Create a \`.env\` file in the root directory.

| Variable | Description | Example |
| :--- | :--- | :--- |
| \`PORT\` | The port the server listens on. | \`3000\` |
| \`API_KEY\` | **Critical**. A comma-separated list of Gemini API keys. | \`AIzaSy...Key1, AIzaSy...Key2\` |

> **Pro Tip:** Providing multiple keys allows the system to automatically rotate them if one hits a rate limit (Failover Strategy).

---

## 🚀 Deployment to Render.com

This API is optimized for cloud deployment. Follow these steps to deploy on Render (Free Tier compatible).

1.  **Push to GitHub**: Ensure this code is in a public or private GitHub repository.
2.  **Create Web Service**:
    *   Log in to [Render dashboard](https://dashboard.render.com/).
    *   Click **New +** -> **Web Service**.
    *   Connect your GitHub repository.
3.  **Configure Service**:
    *   **Runtime**: \`Node\`
    *   **Build Command**: \`npm install\`
    *   **Start Command**: \`node server.js\` (or \`node index.js\`)
4.  **Environment Variables**:
    *   Scroll down to "Environment Variables".
    *   Key: \`API_KEY\`
    *   Value: \`Your_Gemini_API_Key_Here\`
5.  **Deploy**: Click "Create Web Service". Render will detect the Node.js app and start it.

**Health Check**: Once deployed, your URL will look like \`https://teachermada-api.onrender.com\`.

---

## 🔒 Security & Performance

### Rate Limiting
To prevent abuse (DDoS or spam), the API tracks IP addresses.
*   **Limit**: 20 requests per minute per IP.
*   **Action**: Returns \`429 Too Many Requests\` if exceeded.

### API Key Rotation (High Availability)
The system implements an automatic failover mechanism.
1.  The app loads all keys defined in \`API_KEY\`.
2.  If a request fails due to \`429\` (Quota Exceeded) or \`503\` (Overloaded) from Google:
3.  The server **automatically switches** to the next key in the pool and retries the request seamlessly.
4.  The user experiences no downtime.

---

## 📡 API Reference

### \`POST /api/agent/chat\`

#### Request Headers
\`Content-Type: application/json\`

#### Request Body
\`\`\`json
{
  "userId": "facebook_psid_12345",
  "message": "Manao ahoana, mba te hianatra teny anglisy aho",
  "context": {
    "language": "mg",
    "stage": "lead"
  }
}
\`\`\`

#### Response Body
\`\`\`json
{
  "reply": "Manao ahoana tompoko! Faly mandray anao. Mety tsara ny safidinao. Efa manana fahalalana kely ve ianao sa vao manomboka?",
  "detected_language": "mg",
  "intent": "greeting",
  "next_action": "ask_question"
}
\`\`\`
`;
