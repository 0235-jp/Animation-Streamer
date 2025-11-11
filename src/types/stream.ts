export type StreamPhase = 'IDLE' | 'WAITING' | 'SPEECH' | 'STOPPED';

export interface MotionAsset {
  id: string;
  path: string; // absolute path
  durationMs?: number | null;
}

export interface AudioProfileConfig {
  ttsEngine: 'voicevox';
  voicevoxUrl: string;
  speakerId: number;
}

export interface StreamProfileConfig {
  server: {
    port: number;
  };
  rtmp: {
    outputUrl: string;
  };
  waitingMotions: MotionAsset[];
  speechMotions: MotionAsset[];
  audioProfile: AudioProfileConfig;
  assets: {
    tempDir: string;
  };
}

export interface StreamStatusPayload {
  status: StreamPhase;
  sessionId: string | null;
  currentMotionId: string | null;
  queueLength: number;
}
