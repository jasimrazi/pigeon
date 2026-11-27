export interface AppVersionInfo {
  version: string;
  build: number;
  commit: string;
  label: string;
}

export const APP_VERSION = '0.2.0';
export const BUILD_NUMBER = 113;
export const GIT_COMMIT = '4cd656c';

export function getAppVersionInfo(): AppVersionInfo {
  return {
    version: APP_VERSION,
    build: BUILD_NUMBER,
    commit: GIT_COMMIT,
    label: `v${APP_VERSION} #${BUILD_NUMBER} (${GIT_COMMIT})`,
  };
}
