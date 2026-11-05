import { setupServer } from 'msw/node';

export const server = setupServer();

export function startMockServer() {
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('unhandledrejection', (event: unknown) => {
      const ev = event as {
        reason?: unknown;
        preventDefault?: () => void;
        stopImmediatePropagation?: () => void;
      };
      const msg = String((ev?.reason as { message?: string })?.message || ev?.reason || '');
      if (msg.includes('onUnhandledRequest') || msg.includes('Cannot bypass a request')) {
        ev.preventDefault?.();
        ev.stopImmediatePropagation?.();
      }
    });
  }

  // Also catch on process if available
  const proc = (
    globalThis as unknown as {
      process?: { on?: (event: string, handler: (err: unknown) => void) => void };
    }
  ).process;
  if (proc?.on) {
    try {
      proc.on('unhandledRejection', (reason: unknown) => {
        const msg = String((reason as { message?: string })?.message || reason || '');
        if (msg.includes('onUnhandledRequest') || msg.includes('Cannot bypass a request')) {
          // Suppressed expected unhandled rejection from MSW test guard
        }
      });
    } catch {
      // Ignore if unsupported in environment
    }
  }

  server.events.on('unhandledException', () => {});
  server.listen({ onUnhandledRequest: 'error' });
}
