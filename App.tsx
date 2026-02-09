import React, { useState, useCallback, useRef } from 'react';
import { GeminiAgentService } from './services/geminiAgent';
import { MessengerChat } from './components/MessengerChat';
import { ApiLogger } from './components/ApiLogger';
import { AgentRequest, LogEntry, Tab } from './types';
import { NODE_BACKEND_TEMPLATE, README_CONTENT } from './constants';
import { MessageSquare, Code, FileText } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.SIMULATOR);
  const [messages, setMessages] = useState<Array<{id: string, sender: 'user' | 'agent', text: string, timestamp: Date}>>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const agentService = useRef<GeminiAgentService | null>(null);
  
  // Initialize service ref if key is present
  if (!agentService.current && process.env.API_KEY) {
    agentService.current = new GeminiAgentService(process.env.API_KEY);
  }

  const addLog = useCallback((type: 'request' | 'response' | 'error', data: any) => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      data
    };
    setLogs(prev => [newLog, ...prev]);
  }, []);

  const handleSendMessage = async (text: string) => {
    if (!agentService.current) {
      addLog('error', { message: 'Missing API Key in environment variables' });
      return;
    }

    const newMessageId = Math.random().toString(36).substr(2, 9);
    setMessages(prev => [...prev, { id: newMessageId, sender: 'user', text, timestamp: new Date() }]);
    setIsProcessing(true);

    // Simulate Network Payload
    const requestPayload: AgentRequest = {
      userId: 'user_123', // Simulated User ID
      message: text,
      context: {
        language: 'auto', // In a real app, this would come from DB
        stage: 'visitor'  // In a real app, this would come from DB
      }
    };

    addLog('request', requestPayload);

    try {
      const response = await agentService.current.processMessage(requestPayload);
      
      addLog('response', response);

      setMessages(prev => [
        ...prev, 
        { 
          id: Math.random().toString(36).substr(2, 9), 
          sender: 'agent', 
          text: response.reply, 
          timestamp: new Date() 
        }
      ]);
    } catch (error) {
      addLog('error', { message: 'Failed to process message', error });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Navbar */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-md z-20">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-600 p-1.5 rounded-lg">
            <MessageSquare size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">TeacherMada AI Agent</h1>
            <p className="text-xs text-slate-400">Backend API Simulator & Sandbox</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
           {/* API Key management removed as per guidelines */}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar / Tabs */}
        <nav className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col hidden md:flex">
          <div className="p-4 space-y-2">
            <button
              onClick={() => setActiveTab(Tab.SIMULATOR)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                activeTab === Tab.SIMULATOR ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <MessageSquare size={18} />
              <span>Simulator</span>
            </button>
            <button
              onClick={() => setActiveTab(Tab.BACKEND_CODE)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                activeTab === Tab.BACKEND_CODE ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Code size={18} />
              <span>Backend Code</span>
            </button>
            <button
              onClick={() => setActiveTab(Tab.DOCS)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                activeTab === Tab.DOCS ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <FileText size={18} />
              <span>Documentation</span>
            </button>
          </div>
          
          <div className="mt-auto p-4 border-t border-slate-800">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Status</p>
              <div className="flex items-center space-x-2">
                 <div className={`w-2 h-2 rounded-full ${process.env.API_KEY ? 'bg-green-500' : 'bg-red-500'}`}></div>
                 <span className="text-xs text-slate-200">{process.env.API_KEY ? 'API Connected' : 'No Key'}</span>
              </div>
            </div>
          </div>
        </nav>

        {/* Workspace */}
        <main className="flex-1 bg-white relative">
          {activeTab === Tab.SIMULATOR && (
            <div className="h-full flex flex-col md:flex-row">
               <div className="flex-1 h-full md:border-r border-gray-200">
                  <MessengerChat messages={messages} onSendMessage={handleSendMessage} isLoading={isProcessing} />
               </div>
               <div className="w-full md:w-[400px] h-64 md:h-full border-t md:border-t-0 border-gray-200">
                  <ApiLogger logs={logs} />
               </div>
            </div>
          )}

          {activeTab === Tab.BACKEND_CODE && (
            <div className="h-full overflow-y-auto p-8 bg-slate-50">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Node.js Express Backend</h2>
                  <button 
                    onClick={() => navigator.clipboard.writeText(NODE_BACKEND_TEMPLATE)}
                    className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
                  >
                    <Code size={16} />
                    <span>Copy to Clipboard</span>
                  </button>
                </div>
                <div className="bg-slate-900 rounded-xl overflow-hidden shadow-xl border border-slate-800">
                  <div className="flex items-center space-x-2 px-4 py-3 bg-slate-950 border-b border-slate-800">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="ml-2 text-xs text-slate-500 font-mono">server.js</span>
                  </div>
                  <pre className="p-6 overflow-x-auto text-sm font-mono leading-relaxed text-blue-100">
                    {NODE_BACKEND_TEMPLATE}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === Tab.DOCS && (
            <div className="h-full overflow-y-auto p-8 bg-white">
               <div className="max-w-3xl mx-auto prose prose-slate">
                  <pre className="whitespace-pre-wrap font-sans text-gray-700">
                    {README_CONTENT}
                  </pre>
               </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}