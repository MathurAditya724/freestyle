// AudioWorklet processor for PCM16 extraction
// This file is loaded via audioContext.audioWorklet.addModule()

const PROCESSOR_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const copy = new Float32Array(input[0]);
    this.port.postMessage(copy.buffer, [copy.buffer]);
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

let blobUrl: string | null = null;

export function getPCMProcessorUrl(): string {
  if (!blobUrl) {
    const blob = new Blob([PROCESSOR_CODE], { type: "application/javascript" });
    blobUrl = URL.createObjectURL(blob);
  }
  return blobUrl;
}
