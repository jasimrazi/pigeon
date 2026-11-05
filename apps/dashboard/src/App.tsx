import React from 'react';

export function App(): React.JSX.Element {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">Pigeon</h1>
      </header>
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
          <p className="text-sm">Personal job-application automation dashboard</p>
        </div>
      </main>
    </div>
  );
}

export default App;
