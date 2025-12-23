declare module 'wav-decoder' {
  interface AudioData {
    sampleRate: number
    channelData: Float32Array[]
  }

  export function decode(buffer: Buffer): Promise<AudioData>
}
