export interface ChatContext {
  language: string;
  stage: string;
}

export interface AgentRequest {
  userId: string;
  message: string;
  context: ChatContext;
}

export interface AgentResponse {
  reply: string;
  detected_language: string;
  intent: 'greeting' | 'info' | 'learning' | 'pricing' | 'signup' | 'unknown';
  next_action: 'ask_question' | 'present_offer' | 'redirect_human' | 'send_link' | 'none';
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'request' | 'response' | 'error';
  data: any;
}

export enum Tab {
  SIMULATOR = 'simulator',
  BACKEND_CODE = 'backend_code',
  DOCS = 'docs'
}