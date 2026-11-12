import type { JobSource } from '../types.js';
import { adzunaAdapter } from './adzuna.js';
import { remoteokAdapter } from './remoteok.js';
import { remotiveAdapter } from './remotive.js';
import { weWorkRemotelyAdapter, parseRssXml } from './weworkremotely.js';
import { hiringHnAdapter } from './hiring-hn.js';
import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';
import { smartRecruitersAdapter } from './smartrecruiters.js';
import { workableAdapter } from './workable.js';
import { breezyAdapter } from './breezy.js';
import { bambooHrAdapter } from './bamboohr.js';
import { recruiteeAdapter } from './recruitee.js';
import { himalayasAdapter } from './himalayas.js';
import { jobicyAdapter } from './jobicy.js';
import { workingNomadsAdapter } from './workingnomads.js';

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
  smartRecruitersAdapter,
  workableAdapter,
  breezyAdapter,
  bambooHrAdapter,
  recruiteeAdapter,
  himalayasAdapter,
  jobicyAdapter,
  workingNomadsAdapter,
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
  smartrecruiters: smartRecruitersAdapter,
  workable: workableAdapter,
  breezy: breezyAdapter,
  bamboohr: bambooHrAdapter,
  recruitee: recruiteeAdapter,
  himalayas: himalayasAdapter,
  jobicy: jobicyAdapter,
  workingnomads: workingNomadsAdapter,
};
