import { toWav } from "@/lib/audio-recorder";
import { RECORDING_CHUNK_SECONDS } from "@/lib/interview-recording";

// Test hook: the E2E run can't sit through 5 real minutes per chunk to
// exercise rotation, so NEXT_PUBLIC_RECORDING_CHUNK_SECONDS=20 at build
// time shortens it. Unset in every real build.
const CHUNK_SECONDS = Number(process.env.NEXT_PUBLIC_RECORDING_CHUNK_SECONDS) || RECORDING_CHUNK_SECONDS;

/**
 * Long-form recording for a real interview, in 5-minute WAV chunks.
 *
 * MediaRecorder's own timeslice can't be used for this: every slice after
 * the first is a bare continuation with no container header, so it can't be
 * decoded (or transcribed) on its own. Instead the recorder is stopped and
 * restarted on the same stream every RECORDING_CHUNK_SECONDS — each stop
 * yields a complete, standalone file — and each is decoded/downmixed to
 * 16 kHz mono WAV right away and handed to `onChunk`. The gap between two
 * segments is a few milliseconds, which is nothing against a 40-minute
 * conversation, and the payoff is that a crash or a closed laptop lid at
 * minute 38 still leaves 35 minutes safely uploaded.
 */
export type ChunkedRecorder = {
  stop: () => Promise<void>;
  cancel: () => void;
  /** 0..1 instantaneous input level, for the meter. */
  level: () => number;
  /** Whether system audio actually got captured (Windows-only loopback). */
  systemAudioActive: boolean;
};

export async function startChunkedRecording({
  systemAudio,
  onChunk,
  onError,
}: {
  systemAudio: boolean;
  onChunk: (index: number, wav: Blob, durationSec: number) => Promise<void>;
  onError: (message: string) => void;
}): Promise<ChunkedRecorder> {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  // The interviewer's voice comes out of the speakers; on Windows the
  // desktop app's display-media handler answers this with a system-audio
  // loopback track (electron/main.js). On macOS it answers with no audio,
  // and the mic is all there is — the page tells the user to use speakers.
  let system: MediaStream | null = null;
  let systemAudioActive = false;
  if (systemAudio) {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      display.getVideoTracks().forEach((t) => t.stop());
      if (display.getAudioTracks().length > 0) {
        system = new MediaStream(display.getAudioTracks());
        systemAudioActive = true;
      }
    } catch {
      // Denied or unsupported — mic-only is still a valid recording.
    }
  }

  const ctx = new AudioContext();
  const mix = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(mic).connect(mix);
  ctx.createMediaStreamSource(mic).connect(analyser);
  if (system) {
    ctx.createMediaStreamSource(system).connect(mix);
    ctx.createMediaStreamSource(system).connect(analyser);
  }

  let index = 0;
  let recorder: MediaRecorder | null = null;
  let rotateTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  // Chunks are converted + uploaded one after another so two 5-minute
  // decodes never run at once (each is ~60 MB of float samples).
  let pipeline: Promise<void> = Promise.resolve();

  const release = () => {
    mic.getTracks().forEach((t) => t.stop());
    system?.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  function startSegment() {
    const r = new MediaRecorder(mix.stream);
    const parts: Blob[] = [];
    const myIndex = index++;
    // Per-segment, not shared: onstop fires asynchronously, by which time
    // the next segment has already started (and would have reset a shared
    // start timestamp to "now").
    const segmentStart = Date.now();
    r.ondataavailable = (e) => {
      if (e.data.size > 0) parts.push(e.data);
    };
    r.onstop = () => {
      const durationSec = Math.max(0, (Date.now() - segmentStart) / 1000);
      const raw = new Blob(parts, { type: r.mimeType });
      pipeline = pipeline
        .then(async () => {
          if (raw.size === 0) return;
          const wav = await toWav(await raw.arrayBuffer());
          await onChunk(myIndex, wav, durationSec);
        })
        .catch((err) => onError(err instanceof Error ? err.message : "保存录音片段失败"));
    };
    r.onerror = () => onError("录音中断了");
    r.start();
    recorder = r;
    rotateTimer = setTimeout(() => {
      if (stopped) return;
      r.stop();
      startSegment();
    }, CHUNK_SECONDS * 1000);
  }

  startSegment();

  const levelData = new Uint8Array(analyser.frequencyBinCount);

  return {
    systemAudioActive,
    level() {
      analyser.getByteTimeDomainData(levelData);
      let peak = 0;
      for (let i = 0; i < levelData.length; i++) peak = Math.max(peak, Math.abs(levelData[i] - 128) / 128);
      return peak;
    },
    cancel() {
      stopped = true;
      if (rotateTimer) clearTimeout(rotateTimer);
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      release();
    },
    async stop() {
      stopped = true;
      if (rotateTimer) clearTimeout(rotateTimer);
      const r = recorder;
      if (r && r.state !== "inactive") {
        await new Promise<void>((resolve) => {
          const prev = r.onstop;
          r.onstop = (e) => {
            prev?.call(r, e);
            resolve();
          };
          r.stop();
        });
      }
      release();
      await pipeline;
    },
  };
}
