import { startMockServer, server } from './server.js';
import { afterEach, afterAll } from 'vitest';

startMockServer();

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
