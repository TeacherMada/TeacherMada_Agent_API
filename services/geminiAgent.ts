
import { GoogleGenAI, Type } from "@google/genai";
import { AgentRequest, AgentResponse } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants";

interface HistoryContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/**
 * Service Hybrid:
 * 1. SIMULATOR MODE: Runs strictly in-browser using env API Key (Current Demo).
 * 2. PRODUCTION MODE: Should use `fetch` to call your Node.js backend.
 */
export class GeminiAgentService {
  private apiKeys: string[];
  private currentKeyIndex: number = 0;
  private modelName = 'gemini-3-flash-preview';
  private memories: Map<string, HistoryContent[]> = new Map();
  
  private readonly HISTORY_LIMIT = 10;
  private readonly RETAIN_COUNT = 4;

  // Set this to TRUE to test with a real local backend (requires running node server.js on port 3000)
  // For this sandbox environment, we default to FALSE to keep the demo working.
  private readonly USE_REAL_BACKEND = false; 
  private readonly BACKEND_URL = 'http://localhost:3000/api/agent/chat';

  constructor(apiKeyString: string) {
    this.apiKeys = apiKeyString.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }

  // --- CLIENT-SIDE LOGIC (SIMULATOR) ---
  private getClient(): GoogleGenAI {
    const key = this.apiKeys[this.currentKeyIndex];
    return new GoogleGenAI({ apiKey: key });
  }

  private rotateKey() {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
  }

  private async summarizeHistory(history: HistoryContent[]): Promise<HistoryContent[]> {
    if (history.length <= this.HISTORY_LIMIT) return history;
    const messagesToSummarize = history.slice(0, history.length - this.RETAIN_COUNT);
    const recentMessages = history.slice(history.length - this.RETAIN_COUNT);
    const transcript = messagesToSummarize.map(m => `${m.role.toUpperCase()}: ${m.parts[0].text}`).join('\n');
    const prompt = `Summarize conversation. Key facts only.\n\n${transcript}`;

    try {
      const ai = this.getClient();
      const response = await ai.models.generateContent({ model: this.modelName, contents: prompt });
      const summaryText = response.text || "Summary unavailable.";
      const summaryTurn: HistoryContent[] = [
        { role: 'user', parts: [{ text: `[SYSTEM: Summary]: ${summaryText}` }] },
        { role: 'model', parts: [{ text: "Acknowledged." }] }
      ];
      return [...summaryTurn, ...recentMessages];
    } catch (e) { return history; }
  }

  // --- MAIN HANDLER ---
  async processMessage(request: AgentRequest): Promise<AgentResponse> {
    
    // IF PRODUCTION BACKEND IS ENABLED
    if (this.USE_REAL_BACKEND) {
        return this.callBackend(request);
    }

    // ELSE: RUN SIMULATION (BROWSER-SIDE)
    return this.runSimulation(request);
  }

  // --- 1. PRODUCTION METHOD (Example of Frontend Code) ---
  private async callBackend(request: AgentRequest): Promise<AgentResponse> {
    try {
        console.log("📡 Calling Backend API:", this.BACKEND_URL);
        const response = await fetch(this.BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: request.userId,
                message: request.message,
                context: request.context
            })
        });

        if (!response.ok) throw new Error(`Backend Error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error("Backend Call Failed:", error);
        return {
            reply: "⚠️ Erreur de connexion au serveur backend. Vérifiez qu'il tourne sur le port 3000.",
            detected_language: "fr",
            intent: "unknown",
            next_action: "none"
        };
    }
  }

  // --- 2. SIMULATION METHOD (Logic duplicated from Backend for Demo) ---
  private async runSimulation(request: AgentRequest): Promise<AgentResponse> {
    let history = this.memories.get(request.userId) || [];
    if (history.length >= this.HISTORY_LIMIT) {
      history = await this.summarizeHistory(history);
      this.memories.set(request.userId, history);
    }

    const contextStr = request.context ? `[System Context: Lang=${request.context.language}] ` : '';
    const userContent: HistoryContent = { role: 'user', parts: [{ text: `${contextStr}${request.message}` }] };
    const contents = [...history, userContent];

    let attempts = 0;
    while (attempts < this.apiKeys.length) {
      try {
        const ai = this.getClient();
        const response = await ai.models.generateContent({
          model: this.modelName,
          contents: contents,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: { type: Type.STRING },
                detected_language: { type: Type.STRING },
                intent: { type: Type.STRING, enum: ["greeting", "info", "learning", "pricing", "signup", "unknown"] },
                next_action: { type: Type.STRING, enum: ["ask_question", "present_offer", "redirect_human", "send_link", "none"] }
              },
              required: ["reply", "detected_language", "intent", "next_action"]
            }
          },
        });

        if (!response.text) throw new Error("No response text");
        const parsedResponse = JSON.parse(response.text) as AgentResponse;

        this.memories.set(request.userId, [...contents, { role: 'model', parts: [{ text: response.text }] }]);
        return parsedResponse;

      } catch (error) {
        attempts++;
        if (attempts < this.apiKeys.length) { this.rotateKey(); continue; }
        return { reply: "Simulation Error: API Quota Exceeded.", detected_language: "en", intent: "unknown", next_action: "none" };
      }
    }
    return { reply: "Error.", detected_language: "en", intent: "unknown", next_action: "none" };
  }
}
