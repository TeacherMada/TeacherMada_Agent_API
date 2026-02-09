import React from 'react';
import { LogEntry } from '../types';
import { Terminal, ArrowUpCircle, ArrowDownCircle, Clock, CheckCircle, AlertCircle } from 'lucide-react';

interface ApiLoggerProps {
  logs: LogEntry[];
}

export const ApiLogger: React.FC<ApiLoggerProps> = ({ logs }) => {
  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200 font-mono text-xs">
      <div className="flex items-center px-4 py-3 bg-slate-950 border-b border-slate-800">
        <Terminal size={16} className="mr-2 text-green-400" />
        <h3 className="font-semibold text-slate-100">API Live Stream</h3>
        <span className="ml-auto flex items-center text-[10px] text-slate-500">
          <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></div>
          Connected
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {logs.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-600">
            <p>Waiting for requests...</p>
          </div>
        )}
        
        {logs.map((log) => (
          <div key={log.id} className="relative pl-6 border-l-2 border-slate-800 group hover:border-slate-600 transition-colors">
            <div className="absolute -left-[9px] top-0 bg-slate-900">
              {log.type === 'request' ? (
                <ArrowUpCircle size={16} className="text-blue-400" />
              ) : log.type === 'error' ? (
                <AlertCircle size={16} className="text-red-400" />
              ) : (
                <ArrowDownCircle size={16} className="text-green-400" />
              )}
            </div>
            
            <div className="flex items-center mb-2 space-x-2">
              <span className={`uppercase font-bold tracking-wider text-[10px] px-2 py-0.5 rounded ${
                log.type === 'request' ? 'bg-blue-500/10 text-blue-400' : 
                log.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'
              }`}>
                {log.type === 'request' ? 'POST /api/agent/chat' : log.type === 'error' ? 'ERROR 500' : 'RESPONSE 200 OK'}
              </span>
              <span className="text-slate-500 flex items-center">
                <Clock size={10} className="mr-1" />
                {log.timestamp}
              </span>
            </div>

            <div className="bg-slate-950 rounded border border-slate-800 p-3 overflow-x-auto">
              <pre className="whitespace-pre-wrap break-all text-slate-300">
                {JSON.stringify(log.data, null, 2)}
              </pre>
            </div>
            
            {log.type === 'response' && log.data.intent && (
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="inline-flex items-center px-2 py-1 rounded border border-slate-700 bg-slate-800/50 text-slate-400">
                  <span className="text-slate-500 mr-1">Intent:</span>
                  <span className="text-yellow-400">{log.data.intent}</span>
                </div>
                <div className="inline-flex items-center px-2 py-1 rounded border border-slate-700 bg-slate-800/50 text-slate-400">
                  <span className="text-slate-500 mr-1">Action:</span>
                  <span className="text-purple-400">{log.data.next_action}</span>
                </div>
                 <div className="inline-flex items-center px-2 py-1 rounded border border-slate-700 bg-slate-800/50 text-slate-400">
                  <span className="text-slate-500 mr-1">Lang:</span>
                  <span className="text-blue-300">{log.data.detected_language}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
