class PCMPlayer {
  constructor(option) {
    this.init(option);
  }

  init(option) {
    const defaultOption = {
      inputCodec: 'Int16', // The encoding bit of the incoming data, default is 16-bit
      channels: 1, // Number of channels
      sampleRate: 8000, // Sample rate in Hz
      flushTime: 1000, // Buffer time in ms
      fftSize: 2048, // analyserNode fftSize
      silenceThreshold: 33, // Silence duration in ms
    };

    this.option = Object.assign({}, defaultOption, option); // Final configuration parameters of the instance
    this.samples = new Float32Array(); // Sample storage area
    this.interval = setInterval(this.flush.bind(this), this.option.flushTime);
    this.convertValue = this.getConvertValue();
    this.typedArray = this.getTypedArray();
    this.initAudioContext();
    this.bindAudioContextEvent();
    this.silenceStartTime = 0;
  }

  getConvertValue() {
    // Select the basic value needed to convert the data based on the target encoding bits
    const inputCodecs = {
      Int8: 128,
      Int16: 32768,
      Int32: 2147483648,
      Float32: 1,
    };
    if (!inputCodecs[this.option.inputCodec])
      throw new Error(
        'wrong codec.please input one of these codecs: Int8, Int16, Int32, Float32'
      );
    return inputCodecs[this.option.inputCodec];
  }

  getTypedArray() {
    // Select the binary data format needed to save on the frontend based on the target encoding bits
    // For the complete TypedArray, please refer to the documentation
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray
    const typedArrays = {
      Int8: Int8Array,
      Int16: Int16Array,
      Int32: Int32Array,
      Float32: Float32Array,
    };
    if (!typedArrays[this.option.inputCodec])
      throw new Error(
        'wrong codec.please input one of these codecs: Int8, Int16, Int32, Float32'
      );
    return typedArrays[this.option.inputCodec];
  }

  initAudioContext() {
    // Initialize audio context related things
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // GainNode to control volume
    // https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createGain
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = 0.1;
    this.gainNode.connect(this.audioCtx.destination);
    this.startTime = this.audioCtx.currentTime;
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = this.option.fftSize;
  }

  static isTypedArray(data) {
    // Check if the input data is of type TypedArray or ArrayBuffer
    return (
      (data.byteLength &&
        data.buffer &&
        data.buffer.constructor == ArrayBuffer) ||
      data.constructor == ArrayBuffer
    );
  }

  isSupported(data) {
    // Check if data type is supported
    // Currently supports ArrayBuffer or TypedArray
    if (!PCMPlayer.isTypedArray(data))
      throw new Error('Please pass in ArrayBuffer or any TypedArray');
    return true;
  }

  feed(data) {
    this.silenceStartTime = this.audioCtx.currentTime;
    this.isSupported(data);

    // Get the formatted buffer
    data = this.getFormattedValue(data);
    // Start copying buffer data
    // Create a new space for Float32Array
    const tmp = new Float32Array(this.samples.length + data.length);
    // Copy the current instance buffer value (historical buffer)
    // Start copying from the beginning (0)
    tmp.set(this.samples, 0);
    // Copy the new data passed in
    // Start from the historical buffer position
    tmp.set(data, this.samples.length);
    // Assign the new complete buffer data to samples
    // The interval timer will also play data from samples
    this.samples = tmp;
  }

  getFormattedValue(data) {
    if (data.constructor == ArrayBuffer) {
      data = new this.typedArray(data);
    } else {
      data = new this.typedArray(data.buffer);
    }

    let float32 = new Float32Array(data.length);

    for (let i = 0; i < data.length; i++) {
      // The buffer data needs to be linear PCM in IEEE754 32-bit format, ranging from -1 to +1
      // So divide the data
      // Divide by the corresponding bit range to get data ranging from -1 to +1
      float32[i] = data[i] / this.convertValue;
    }
    return float32;
  }

  volume(volume) {
    this.gainNode.gain.value = volume;
  }

  destroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.samples = null;
    this.audioCtx.close();
    this.audioCtx = null;
  }

  checkSilence() {
    if (
      this.silenceStartTime &&
      this.audioCtx.currentTime - this.silenceStartTime >
        this.option.silenceThreshold / 1000
    ) {
      if (typeof this.option.onsilent === 'function') {
        this.option.onsilent(this);
      }
      this.silenceStartTime = 0;
    }
  }

  flush() {
    if (!this.samples.length) {
      this.checkSilence();
      return;
    }
    const self = this;
    var bufferSource = this.audioCtx.createBufferSource();
    if (typeof this.option.onended === 'function') {
      bufferSource.onended = function (event) {
        self.option.onended(this, event);
      };
    }
    const length = this.samples.length / this.option.channels;
    const audioBuffer = this.audioCtx.createBuffer(
      this.option.channels,
      length,
      this.option.sampleRate
    );

    for (let channel = 0; channel < this.option.channels; channel++) {
      const audioData = audioBuffer.getChannelData(channel);
      let offset = channel;
      let decrement = 50;
      for (let i = 0; i < length; i++) {
        audioData[i] = this.samples[offset];
        /* fadein */
        if (i < 50) {
          audioData[i] = (audioData[i] * i) / 50;
        }
        /* fadeout */
        if (i >= length - 51) {
          audioData[i] = (audioData[i] * decrement--) / 50;
        }
        offset += this.option.channels;
      }
    }

    if (this.startTime < this.audioCtx.currentTime) {
      this.startTime = this.audioCtx.currentTime;
    }
    console.log(
      'start vs current ' +
        this.startTime +
        ' vs ' +
        this.audioCtx.currentTime +
        ' duration: ' +
        audioBuffer.duration
    );
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(this.gainNode);
    bufferSource.connect(this.analyserNode); // bufferSource connects to analyser
    bufferSource.start(this.startTime);
    setTimeout(
      () => {
        if (typeof this.option.onstart === 'function') {
          self.option.onstart(this);
        }
      },
      (this.startTime - this.audioCtx.currentTime) * 1000
    );
    this.startTime += audioBuffer.duration;
    this.samples = new Float32Array();
  }

  async pause() {
    await this.audioCtx.suspend();
  }

  async continue() {
    await this.audioCtx.resume();
  }

  bindAudioContextEvent() {
    const self = this;
    if (typeof self.option.onstatechange === 'function') {
      this.audioCtx.onstatechange = function (event) {
        self.audioCtx &&
          self.option.onstatechange(this, event, self.audioCtx.state);
      };
    }
  }
}

export default PCMPlayer;
