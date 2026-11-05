import React from 'react';
import { ManualQueueView } from './components/ManualQueueView.js';

export function App(): React.JSX.Element {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="border-b bg-white px-6 py-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-2xl">🕊️</span>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">Pigeon</h1>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
          Manual Apply
        </span>
      </header>
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <ManualQueueView />
      </main>
    </div>
  );
}

export default App;
