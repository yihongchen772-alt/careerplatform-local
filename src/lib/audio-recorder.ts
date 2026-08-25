/**
 * Microphone capture that hands back a 16 kHz mono WAV.
 *
 * MediaRecorder in Chromium produces WebM/Opus, which is *not* on Gemini's
 * list of accepted audio containers — and rather than gamble on whether it
 * would be tolerated, the recording is decoded and re-encoded to WAV here.
 * WAV is verified working (a real Chinese speech sample transcribed
 * correctly in ~3s). Downmixing to 16 kHz mono along the way also cuts the
 * upload to roughly a tenth of the raw 48 kHz stereo size, which matters
 * because a spoken answer runs a couple of minutes.
 */

const TARGET_SAMPLE_RATE = 16000;

export type Recorder = {
  /** Resolves to the recorded audio as a 16 kHz mono WAV. */
  stop: () => Promise<Blob>;
  /** Abandons the recording and releases the microphone. */
  cancel: () => void;
};

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // The browser's own cleanup is better than anything done afterwards,
      // and interview answers are recorded in whatever room the user is in.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    cancel() {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
    stop() {
      return new Promise<Blob>((resolve, reject) => {
        recorder.onstop = async () => {
          release();
          try {
            const raw = new Blob(chunks, { type: recorder.mimeType });
            resolve(await toWav(await raw.arrayBuffer()));
          } catch (err) {
            reject(err);
          }
        };
        recorder.onerror = () => {
          release();
          reject(new Error("录音失败"));
        };
        if (recorder.state === "inactive") recorder.onstop?.(new Event("stop"));
        else recorder.stop();
      });
    },
  };
}

async function toWav(encoded: ArrayBuffer): Promise<Blob> {
  // decodeAudioData understands whatever container MediaRecorder produced,
  // so nothing here depends on which one that turned out to be.
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(encoded);
  } finally {
    void decodeCtx.close();
  }

  // Resample by rendering through an OfflineAudioContext at the target rate
  // rather than picking samples by hand — that would alias badly on speech.
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const resampled = await offline.startRendering();

  return new Blob([encodeWav(resampled.getChannelData(0), TARGET_SAMPLE_RATE)], {
    type: "audio/wav",
  });
}

/** Float samples in [-1,1] -> a 16-bit PCM WAV file. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: values slightly outside [-1,1] are legal and
    // would wrap around into loud noise if written unclamped.
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}
