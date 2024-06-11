export const moduleCode = `
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    if (sampleRate !== 16000) {
      throw new Error("Worker: Sample rate must be 16kHz!");
    }
    
    this.buffer = [];
    this.port.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    const audioData = new Uint8Array(event.data);
    const float32Array = this.pcm16ToFloat32(audioData);
    this.buffer.push(...float32Array);

    console.log("Worker: Buffer size", this.buffer.length);
  }

  pcm16ToFloat32(audioData) {
    const int16Array = new Int16Array(audioData.length / 2);

    for (let i = 0, j = 0; i < audioData.length; i += 2, j++) {
      int16Array[j] = (audioData[i + 1] << 8) | audioData[i];
    }
  
    const float32Array = new Float32Array(audioData.length / 2);

    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    return float32Array;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const channel = output[0];

    if (this.buffer.length < channel.length) {
      this.fillBufferWithZeros(channel.length - this.buffer.length);
    }
    
    for (let i = 0; i < channel.length; i++) {
      channel[i] = this.buffer.length > 0 ? this.buffer.shift() : 0;
    }
    
    return true;
  }

  fillBufferWithZeros(count) {
    for (let i = 0; i < count; i++) {
      this.buffer.push(0);
    }
  }
}

registerProcessor('pcm-player', PCMPlayerProcessor);
`;
