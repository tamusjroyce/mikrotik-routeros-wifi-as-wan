export type ScriptVariables = {
  ssid: string;
  wifiPassword: string;
  wifiInterfaces: string[];
  backupWifiInterface: string;
  useWifi2Backup: boolean;
  natComment: string;
  dhcpCommentPrefix: string;
  internetCheckTargets: string[];
};

export type RouterSettings = {
  url: string;
  username: string;
  password?: string;
  scriptFile: string;
};

export type RouterStatus = {
  reachable: boolean;
  internetReachable: boolean;
  activeWanInterface?: string;
  scriptUploaded: boolean;
  schedulerInstalled: boolean;
  bandwidth: BandwidthStatus;
  wifi: unknown[];
  registrations: unknown[];
  dhcpClients: unknown[];
  routes: unknown[];
  error?: string;
};

export type BandwidthStatus = {
  activeInterface?: string;
  rxBitsPerSecond?: number;
  txBitsPerSecond?: number;
  rxRate?: number;
  txRate?: number;
  signal?: string;
  note?: string;
};

export type ApplyResult = {
  uploaded: boolean;
  imported: boolean;
  fileName: string;
  message: string;
};
