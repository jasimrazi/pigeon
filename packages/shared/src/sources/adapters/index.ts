import type { JobSource } from '../types.js';
import { adzunaAdapter } from './adzuna.js';
import { remoteokAdapter } from './remoteok.js';
import { remotiveAdapter } from './remotive.js';
import { weWorkRemotelyAdapter, parseRssXml } from './weworkremotely.js';
import { hiringHnAdapter } from './hiring-hn.js';
import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';

export {
  adzunaAdapter,
  remoteokAdapter,
  remotiveAdapter,
  weWorkRemotelyAdapter,
  parseRssXml,
  hiringHnAdapter,
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
};

export const ALL_SOURCES: Record<string, JobSource> = {
  adzuna: adzunaAdapter,
  remoteok: remoteokAdapter,
  remotive: remotiveAdapter,
  weworkremotely: weWorkRemotelyAdapter,
  hiring_hn: hiringHnAdapter,
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
};
