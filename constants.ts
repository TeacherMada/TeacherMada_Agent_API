
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
 * 
 * Features:
 * - Multi-key rotation (High Availability)
 * - Rate Limiting (DDoS protection)
 * - Context Awareness (Summarization)
 */
require('dotenv').config();
const express = require('express');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
app.use(express.json());

// --- Security: API Key Rotation & Failover ---
// Expects API_KEY to be a comma-separated list in .env: "key1,key2,key3"
const API_KEYS = (process.env.API_KEY || '').split(',').map(k => k.trim()).filter(k => k);
let currentKeyIndex = 0;

if (API_KEYS.length === 0) {
  console.error("CRITICAL ERROR: No API Keys found in .env variable API_KEY");
  process.exit(1);
}

const getGenAIClient = () => {
  const key = API_KEYS[currentKeyIndex];
  return new GoogleGenAI({ apiKey: key });
};

const rotateKey = () => {
  const prevIndex = currentKeyIndex;
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.warn(\`⚠️ API Limit/Error on Key \${prevIndex}. Rotating to Key \${currentKeyIndex}...\`);
};

const MODEL_NAME = 'gemini-3-flash-preview';

// --- Security: Rate Limiting ---
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_IP = 20;

const checkRateLimit = (ip) => {
  const now = Date.now();
  const userHistory = rateLimit.get(ip) || [];
  const validRequests = userHistory.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  if (validRequests.length >= MAX_REQUESTS_PER_IP) return false;
  
  validRequests.push(now);
  rateLimit.set(ip, validRequests);
  return true;
};

// --- Memory: Conversation Store ---
const conversationStore = new Map();
const HISTORY_LIMIT = 10;
const RETAIN_COUNT = 4;

// --- Prompt Configuration ---
const SYSTEM_INSTRUCTION = \`
You are the TeacherMada AI Agent. Your goal is to assist users in choosing a language course.
Identify language (Fr, En, Mg) and reply in that language.
Be concise, motivating, and helpful.
\`;

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

// --- Helper: Summarize Conversation ---
async function summarizeHistory(history) {
  if (history.length <= HISTORY_LIMIT) return history;
  
  console.log("Creating conversation summary...");
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
    // Inject summary as system context
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

// --- API Endpoint ---
app.post('/api/agent/chat', async (req, res) => {
  try {
    // 1. Rate Limiting Check
    if (!checkRateLimit(req.ip)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    const { userId, message, context } = req.body;
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'Missing required fields: userId, message' });
    }

    // 2. Memory Retrieval & Summarization
    let history = conversationStore.get(userId) || [];
    history = await summarizeHistory(history);
    conversationStore.set(userId, history);

    // 3. Construct Prompt
    const chatContext = context ? \`[System Context: Language=\${context.language}, Stage=\${context.stage}] \` : '';
    const userContent = { role: 'user', parts: [{ text: \`\${chatContext}\${message}\` }] };
    const promptContents = [...history, userContent];

    // 4. AI Execution with Failover Strategy
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
          rotateKey(); // Switch to next key
        } else {
          throw new Error("Service Unavailable: All API keys exhausted.");
        }
      }
    }

    // 5. Update History & Respond
    if (success && jsonResponse) {
      const modelContent = { role: 'model', parts: [{ text: rawResponseText }] };
      conversationStore.set(userId, [...promptContents, modelContent]);
      
      console.log(\`✅ [SUCCESS] User: \${userId} | Intent: \${jsonResponse.intent} | Lang: \${jsonResponse.detected_language}\`);
      res.json(jsonResponse);
    }

  } catch (error) {
    console.error('🔥 CRITICAL ERROR:', error);
    res.status(500).json({ 
      reply: "Désolé, une erreur technique est survenue. Veuillez réessayer.",
      intent: "unknown",
      next_action: "none"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`🚀 TeacherMada Agent API running on port \${PORT}\`);
  console.log(\`🔑 Loaded \${API_KEYS.length} API Keys for rotation.\`);
});
`;

export const README_CONTENT = `# 🎓 TeacherMada AI Agent API

A production-ready, stateless REST API serving as the intelligence engine for the TeacherMada language learning platform. It leverages **Google Gemini 1.5 Flash** to provide multilingual, context-aware educational assistance.

## 🚀 Features

*   **Multilingual Support**: Auto-detects and speaks English, French, and Malagasy.
*   **Structured JSON Output**: Deterministic responses suitable for programmatic integration (Messenger/WhatsApp bots).
*   **High Availability**: Implements **API Key Rotation** to bypass rate limits and quotas.
*   **Context Memory**: Maintains conversation history with auto-summarization for long chats.
*   **Security**: IP-based Rate Limiting to prevent abuse.

---

## 🛠️ Configuration & Setup

### 1. Prerequisites
*   Node.js v18+
*   Google Cloud Project with Gemini API enabled
*   API Keys from [Google AI Studio](https://aistudio.google.com/)

### 2. Installation

\`\`\`bash
git clone https://github.com/your-repo/teachermada-api.git
cd teachermada-api
npm install express @google/genai dotenv
\`\`\`

### 3. Environment Variables (.env)

Create a \`.env\` file in the root directory.

| Variable | Required | Description | Example |
| :--- | :--- | :--- | :--- |
| \`API_KEY\` | **Yes** | Comma-separated list of Gemini API Keys. | \`AIzaSy...Key1, AIzaSy...Key2\` |
| \`PORT\` | No | Port for the server. Defaults to 3000. | \`8080\` |

> **Why multiple keys?** The system automatically rotates to the next key if Google returns a \`429\` (Quota Exceeded) or \`503\` error, ensuring zero downtime for users.

---

## ☁️ Deployment Guide (Render.com)

This API is stateless and optimized for serverless/containerized environments like Render.

1.  **Create a New Web Service** on [Render Dashboard](https://dashboard.render.com/).
2.  **Connect your GitHub Repo**.
3.  **Settings**:
    *   **Runtime**: Node
    *   **Build Command**: \`npm install\`
    *   **Start Command**: \`node server.js\` (or \`node index.js\`)
4.  **Environment Variables**:
    *   Add \`API_KEY\` with your comma-separated keys.
5.  **Deploy**.

---

## 📡 API Reference

### Chat Endpoint

**URL**: \`/api/agent/chat\`
**Method**: \`POST\`
**Content-Type**: \`application/json\`

#### Request Body

| Field | Type | Description |
| :--- | :--- | :--- |
| \`userId\` | \`string\` | Unique identifier for the user (e.g., PSID). |
| \`message\` | \`string\` | The user's input text. |
| \`context\` | \`object\` | (Optional) Metadata like current stage or language. |

**Example Request:**

\`\`\`bash
curl -X POST https://your-app.onrender.com/api/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "user_123",
    "message": "Ohatrinona ny saram-pianarana?",
    "context": { "stage": "visitor" }
  }'
\`\`\`

#### Response Body

The API guarantees a structured JSON response.

\`\`\`json
{
  "reply": "Manao ahoana tompoko! Ny saram-pianarana dia 50,000 Ar isam-bolana. Te hahafantatra ny fomba fandoavam-bola ve ianao?",
  "detected_language": "mg",
  "intent": "pricing",
  "next_action": "ask_question"
}
\`\`\`

| Field | Description | Possible Values |
| :--- | :--- | :--- |
| \`intent\` | Classification of user goal | \`greeting\`, \`info\`, \`learning\`, \`pricing\`, \`signup\` |
| \`next_action\` | Suggested UI action | \`ask_question\`, \`present_offer\`, \`redirect_human\`, \`send_link\` |

---

## 🛡️ Error Handling

*   **429 Too Many Requests**: The IP has exceeded 20 requests/minute.
*   **500 Internal Server Error**: General failure (or all API keys exhausted). The bot will fallback to a generic error message in the JSON response asking to wait or contact support.
`;
