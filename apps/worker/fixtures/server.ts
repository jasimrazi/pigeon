import { setupServer } from 'msw/node';

export const server = setupServer();

export function startMockServer() {
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('unhandledrejection', (event) => {
      const err = event?.reason as Error | undefined;
      if (
        err?.message?.includes('onUnhandledRequest') ||
        err?.message?.includes('Cannot bypass a request')
      ) {
        event.preventDefault();
      }
    });
  }

  server.events.on('unhandledException', () => {});
  server.listen({ onUnhandledRequest: 'error' });
}
