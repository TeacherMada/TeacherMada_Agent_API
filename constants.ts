
export const SYSTEM_INSTRUCTION = `
You are "TSANTA", a senior commercial advisor for TeacherMada.

IDENTITY & STRICT BEHAVIOR:
- **HUMAN PERSONA**: You are a real person, an advisor. NEVER mention you are an AI, a bot, an assistant, or software. Act naturally, warmly, and professionally.
- **TONE**: Friendly, dynamic, reassuring, and clear.
- **SALES STRATEGY**: Soft sales. Do not force. Listen to the user's needs first.

**FORMATTING RULES (CRITICAL - FOLLOW THESE STRICTLY):**
1. **FORCE NEWLINES**: You MUST insert a physical line break (\n) AFTER every single category, list item, choice, title, or emoji section.
2. **VERTICAL LAYOUT**: The output must be vertical, not horizontal. Do not bunch items together.
3. **LISTS**: Use bullets (•), dashes (-), or numbers (1.) for every option.
4. **AIRY TEXT**: Use spacing between distinct thoughts.

KNOWLEDGE BASE (THE TRUTH):

1. **OFFER 1: FACEBOOK PACK (The "Complete Pack")**
   - **Price**: 15,000 Ar per language (One-time payment).
   - **Structure**: Access to a **Private Group** containing 3 distinct levels:
     • Beginner (~30 lessons)
     • Intermediate
     • Advanced
   - **Method**: Downloadable videos + Explanations in Malagasy.
   - **Target**: People with bad internet or who want to learn at their own pace.
   - **Languages**: English, French, Chinese.

2. **OFFER 2: WEB APP (The "Smart Class")**
   - **Link**: https://teachermada.onrender.com
   - **Price**: Pay-as-you-go. 50 Ar per lesson (1 Credit = 50 Ar).
   - **Content**: Interactive Smart Prof, Voice/Dialogue practice, Exercises.
   - **Languages**: 12+ languages available.

3. **PAYMENT & CONTACTS**:
   - **Mobile Money Numbers**:
     • MVola: 034 93 102 68
     • Orange Money: 032 69 790 17
     • Airtel Money: 033 38 784 20
     • **Beneficiary Name**: Tsanta Fiderana
   - **After Payment**: The user MUST send a proof of payment to the Admin.
   - **Admin Contacts**:
     • Facebook: https://www.facebook.com/tsanta.rabe.53113
     • WhatsApp: 034 93 102 68

RULES OF ENGAGEMENT:
1. **Duration**: If asked about duration, say "It depends on your own pace" (ny rythme-nao).
2. **Pricing**: Do not state the price immediately unless asked. Let the user express interest first.
3. **Validation**: If a user says they paid, congratulate them warmly and give them the Admin Contact links (FB/WhatsApp) to validate their access.
4. **Distinction**: Clearly distinguish between the Facebook Pack (Videos/Group) and the App (Interactive).

RESPONSE FORMAT (JSON ONLY):
{
  "reply": "Your structured, vertical, human-like response here.",
  "detected_language": "fr" | "en" | "mg",
  "intent": "greeting" | "info" | "learning" | "pricing" | "signup",
  "next_action": "ask_question" | "present_offer" | "redirect_human" | "send_link"
}
`;

export const NODE_BACKEND_TEMPLATE = `/**
 * 🚀 TeacherMada Backend Server
 * Architecture: Node.js + Express + Google Gemini SDK
 * Deployment: Ready for Render / Vercel / Heroku
 */

// --- 1. DEPENDENCIES & SETUP ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || '*', // Allow Frontend URL
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// --- 2. CONFIGURATION & SECRETS ---
const API_KEYS = (process.env.API_KEY || '').split(',').map(k => k.trim()).filter(k => k);
const MODEL_NAME = 'gemini-3-flash-preview';

if (API_KEYS.length === 0) {
  console.error("❌ CRITICAL: No API Keys found in .env variable API_KEY");
  process.exit(1);
}

// --- 3. SERVICES (Gemini Manager) ---
class GeminiService {
  constructor(keys) {
    this.keys = keys;
    this.currentIndex = 0;
  }

  getClient() {
    return new GoogleGenAI({ apiKey: this.keys[this.currentIndex] });
  }

  rotateKey() {
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    console.log(\`🔄 Rotating API Key to index \${this.currentIndex}\`);
  }

  async generateResponse(message, history = [], context = {}) {
    let attempts = 0;
    const prompt = \`User Message: \${message}\nContext: \${JSON.stringify(context)}\`;

    // System Instruction (Tsanta Persona)
    const SYSTEM_INSTRUCTION = \`${SYSTEM_INSTRUCTION}\`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        reply: { type: Type.STRING },
        detected_language: { type: Type.STRING },
        intent: { type: Type.STRING, enum: ["greeting", "info", "learning", "pricing", "signup", "unknown"] },
        next_action: { type: Type.STRING, enum: ["ask_question", "present_offer", "redirect_human", "send_link", "none"] }
      },
      required: ["reply", "detected_language", "intent", "next_action"]
    };

    while (attempts < this.keys.length) {
      try {
        const ai = this.getClient();
        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.7,
          },
        });

        if (!response.text) throw new Error("Empty response from Gemini");
        return JSON.parse(response.text);

      } catch (error) {
        console.error(\`⚠️ Error with Key \${this.currentIndex}: \${error.message}\`);
        this.rotateKey();
        attempts++;
      }
    }
    throw new Error("All API keys exhausted or service unavailable.");
  }
}

const geminiService = new GeminiService(API_KEYS);

// --- 4. ROUTES ---

// Health Check
app.get('/', (req, res) => {
  res.status(200).json({ status: 'online', service: 'TeacherMada AI Agent' });
});

// Main Chat Endpoint
app.post('/api/agent/chat', async (req, res) => {
  try {
    const { userId, message, context, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message field is required" });
    }

    console.log(\`📩 Request from \${userId}: \${message.substring(0, 50)}...\`);

    const result = await geminiService.generateResponse(message, history || [], context || {});

    // Add metadata for debugging/logging
    const responsePayload = {
      ...result,
      timestamp: new Date().toISOString(),
      model: MODEL_NAME
    };

    res.json(responsePayload);

  } catch (error) {
    console.error("🔥 Server Error:", error);
    res.status(500).json({ 
      reply: "Désolé, une erreur technique est survenue. Veuillez réessayer.",
      intent: "unknown",
      next_action: "none"
    });
  }
});

// --- 5. START SERVER ---
app.listen(PORT, () => {
  console.log(\`✅ TeacherMada Backend running on port \${PORT}\`);
  console.log(\`🔑 Loaded \${API_KEYS.length} API Keys\`);
});
`;

export const README_CONTENT = `# 🏗️ Architecture TeacherMada : Frontend & Backend

Ce projet est conçu pour être séparé en deux dépôts distincts (ou un monorepo) pour la production.

## 📂 Structure de Dossiers Recommandée

\`\`\`text
/teacher-mada-project
├── /backend                 # API Node.js/Express
│   ├── /src
│   │   ├── services/       # Logique Gemini (rotation clés, etc.)
│   │   ├── routes/         # Définition des endpoints
│   │   └── server.js       # Point d'entrée
│   ├── .env                # API_KEY, PORT
│   ├── package.json
│   └── README.md
│
├── /frontend                # App React/Vite
│   ├── /src
│   │   ├── /components     # UI (Chat, Input)
│   │   ├── /services       # Appels API (fetch / axios)
│   │   └── App.tsx
│   ├── .env                # VITE_API_URL
│   ├── package.json
│   └── vite.config.ts
\`\`\`

---

## 🖥️ 1. Configuration Backend (Node.js)

### \`package.json\` (Backend)
\`\`\`json
{
  "name": "teachermada-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "@google/genai": "^0.1.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
\`\`\`

### Installation & Lancement
1. \`cd backend\`
2. \`npm install\`
3. Créer un fichier \`.env\` :
   \`\`\`env
   PORT=3000
   API_KEY=votre_cle_gemini_1,votre_cle_gemini_2
   FRONTEND_URL=https://votre-frontend.vercel.app
   \`\`\`
4. \`npm start\`

---

## 🎨 2. Configuration Frontend (React + Vite)

### Appels API depuis le Frontend
Ne jamais appeler Gemini directement depuis le front en production. Utilisez ce service :

\`\`\`typescript
// src/services/api.ts
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const sendMessageToAgent = async (message: string, userId: string) => {
  const response = await fetch(\`\${API_URL}/api/agent/chat\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, message })
  });
  
  if (!response.ok) throw new Error('API Error');
  return await response.json();
};
\`\`\`

### Variables d'environnement Frontend (\`.env\`)
\`\`\`env
VITE_API_URL=https://votre-backend-render.com
\`\`\`

---

## 🚀 Déploiement Production

### A. Déployer le Backend (Render Web Service)
1. Créer un nouveau **Web Service** sur Render.
2. Connecter le repo Backend.
3. Build Command: \`npm install\`
4. Start Command: \`node server.js\`
5. **IMPORTANT**: Ajouter les Environment Variables (\`API_KEY\`).

### B. Déployer le Frontend (Vercel / Render Static)
1. Créer un **Static Site**.
2. Build Command: \`npm run build\`
3. Publish Directory: \`dist\`
4. **IMPORTANT**: Ajouter \`VITE_API_URL\` pointant vers l'URL du backend déployé.
`;
