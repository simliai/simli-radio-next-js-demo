import React, {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";

import { moduleCode } from "./audioProcessor";
import PCMPlayer from 'pcm-player';

interface ImageFrame {
  frameWidth: number;
  frameHeight: number;
  imageData: Uint8Array;
}

interface props {
  // Start the stream
  start: boolean;

  // Session token for the video
  sessionToken: string;

  // Minimum chunk size for decoding,
  // Higher chunk size will result in longer delay but smoother playback
  // ( 1 chunk = 0.033 seconds )
  // ( 30 chunks = 0.99 seconds )
  minimumChunkSize?: number;
}

const SimliFaceStream = forwardRef(
  ({ start, sessionToken, minimumChunkSize = 6 }: props, ref) => {
    useImperativeHandle(ref, () => ({
      sendAudioDataToLipsync,
    }));
    SimliFaceStream.displayName = "SimliFaceStream";

    const ws = useRef<WebSocket | null>(null); // WebSocket connection for audio data

    const startTime = useRef<any>();
    const executionTime = useRef<any>();

    const numberOfChunksInQue = useRef<number>(0); // Number of buffered chunks in queue waiting to be decoded

    const startTimeFirstByte = useRef<any>(null);
    const timeTillFirstByte = useRef<any>(null);

    // ------------------- AUDIO -------------------
    const audioPCMPlayer = useRef<PCMPlayer | null>(null); // Ref for audio PCM player
    const audioContext = useRef<AudioContext | null>(null); // Ref for audio context
    const audioNode = useRef<AudioWorkletNode | null>(null); // Ref for audio node
    const audioQueue = useRef<Array<Uint8Array>>([]); // Ref for audio queue

    const accumulatedAudioBuffer = useRef<Uint8Array>(null); // Buffer for accumulating incoming data until it reaches the minimum size for decoding

    const playbackDelay = minimumChunkSize * (1000 / 30); // Playback delay for audio and video in milliseconds

    const callCheckAndPlayFromQueueOnce = useRef<boolean>(true);
    const audioQueueEmpty = useRef<boolean>(false);

    // ------------------- VIDEO -------------------
    const frameQueue = useRef<Array<ImageFrame>>([]); // Queue for storing video data

    const accumulatedFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
    const currentFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [videoContext, setVideoContext] =
      useState<CanvasRenderingContext2D | null>(null);
    const currentFrame = useRef(0);

    const fps = 30;
    const frameInterval = 33; // Calculate the time between frames in milliseconds

    /* Create AudioContext at the start */
    useEffect(() => {
      // Return if start is false
      if (start === false) return;

      // Return if sessionToken is empty or not correct
      if (sessionToken.length < 20) {
        console.error("Error in session token:", sessionToken);
        return;
      }

      // Initialize PCMPlayer
      audioPCMPlayer.current = new PCMPlayer({
        inputCodec: 'Int16',
        channels: 1,
        sampleRate: 16000,
        flushTime: 0,
        fftSize: 32,
      });
      audioPCMPlayer.current.volume(1.0);

      // Initialize AudioContext
      loadAudioWorklet();

      // Intialize VideoContext
      const videoCanvas = canvasRef.current;
      if (videoCanvas) {
        setVideoContext(videoCanvas?.getContext("2d"));
        console.log("VideoContext created");
      }

    }, [start]);

    const sendAudioDataToLipsync = (audioData: Uint8Array) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(audioData);
        startTimeFirstByte.current = performance.now(); // Start time for first byte
      }
    };

    const loadAudioWorklet = async () => {
      try {
        const newAudioContext = new AudioContext({ sampleRate: 16000 });
        const blob = new Blob([moduleCode], { type: "application/javascript" });
        const blobURL = URL.createObjectURL(blob);
        await newAudioContext.audioWorklet.addModule(blobURL);
        const newAudioNode = new AudioWorkletNode(newAudioContext, 'pcm-player');
        newAudioNode.connect(newAudioContext.destination);

        audioContext.current = newAudioContext;
        audioNode.current = newAudioNode;
        console.log("AudioContext created");
      } catch (error) {
        console.error("Error loading AudioWorklet module:", error);
      }
    };

    /* Process Data Bytes to Audio and Video */
    const processToVideoAudio = async (dataArrayBuffer: ArrayBuffer) => {
      let data = new Uint8Array(dataArrayBuffer);

      // --------------- WEBSOCKET SCHEMA ----------------
      // READ MORE: https://github.com/simliai/simli-next-js-demo/blob/main/Websockets.md

      // 5 bytes for VIDEO message
      const start_VIDEO = 0;
      const end_VIDEO = 5;

      // 4 bytes for total number of video bytes
      const start_numberOfVideoBytes = end_VIDEO;
      const end_numberOfVideoBytes = start_numberOfVideoBytes + 4;
      const numberOfVideoBytes = new DataView(
        data.buffer.slice(start_numberOfVideoBytes, end_numberOfVideoBytes)
      ).getUint32(0, true);

      // 4 bytes for frame index
      const start_frameIndex = end_numberOfVideoBytes;
      const end_frameIndex = start_frameIndex + 4;

      // 4 bytes for frame width
      const start_frameWidth = end_frameIndex;
      const end_frameWidth = start_frameWidth + 4;

      // 4 bytes for frame height
      const start_frameHeight = end_frameWidth;
      const end_frameHeight = start_frameHeight + 4;

      // v bytes for video data
      const start_imageData = end_frameHeight;
      const end_imageData = 9 + numberOfVideoBytes; // we add 9 since we have 4+4+4=9 bytes before the image data

      // 5 bytes for AUDIO message
      const start_AUDIO = end_imageData;
      const end_AUDIO = start_AUDIO + 5;

      // 4 bytes for total number of audio bytes
      const start_numberOfAudioBytes = end_AUDIO;
      const end_numberOfAudioBytes = start_numberOfAudioBytes + 4;
      const numberOfAudioBytes = new DataView(
        data.buffer.slice(start_numberOfAudioBytes, end_numberOfAudioBytes)
      ).getUint32(0, true);

      // a bytes for audio data
      const start_audioData = end_numberOfAudioBytes;
      const end_audioData = start_audioData + numberOfAudioBytes;

      // --------------- VIDEO DATA ----------------

      // For debugging: this should return "VIDEO"
      const videoMessage = new TextDecoder().decode(
        data.slice(start_VIDEO, end_VIDEO)
      );

      const frameWidth = new DataView(
        data.buffer.slice(start_frameWidth, end_frameWidth)
      ).getUint32(0, true);

      const frameHeight = new DataView(
        data.buffer.slice(start_frameHeight, end_frameHeight)
      ).getUint32(0, true);

      const imageData = data.subarray(start_imageData, end_imageData); // The rest is image data

      // Push image data to frame queue
      const imageFrame: ImageFrame = { frameWidth, frameHeight, imageData };

      // --------------- AUDIO DATA ----------------

      // For debugging: this should return "AUDIO"
      const audioMessage = new TextDecoder().decode(
        data.slice(start_AUDIO, end_AUDIO)
      );

      // Extract Audio data
      const audioData = data.subarray(start_audioData, end_audioData);
      let audioDataUint8 = new Uint8Array(1068);
      audioDataUint8.set(audioData, 0);

      // --------------- Update Audio and Video Queue ---------------
      updateAudioAndVideoQueue(audioDataUint8, imageFrame);

      // --------------- LOGGING ----------------

      // console.log(
      //   "VIDEO: ", start_VIDEO, end_VIDEO, "\n",
      //   "numberOfVideoBytes: ", start_numberOfVideoBytes, end_numberOfVideoBytes, "=", numberOfVideoBytes, "\n",
      //   "frameIndex: ", start_frameIndex, end_frameIndex, "\n",
      //   "frameWidth: ", start_frameWidth, end_frameWidth, "\n",
      //   "frameHeight: ", start_frameHeight, end_frameHeight, "\n",
      //   "imageData: ", start_imageData, end_imageData, "\n",
      //   "AUDIO: ", start_AUDIO, end_AUDIO, "\n",
      //   "numberOfAudioBytes: ", start_numberOfAudioBytes, end_numberOfAudioBytes, "=", numberOfAudioBytes, "\n",
      //   "audioData: ", start_audioData, end_audioData
      // );

      // console.log(
      //   `${videoMessage}: ${imageData.byteLength}\n` +
      //     `${audioMessage}: ${audioData.byteLength}\n`
      // );

      // console.warn("");
    };

    /* Connect with Lipsync stream */
    useEffect(() => {
      // Return if start is false
      if (start === false) return;

      const ws_lipsync = new WebSocket("wss://api.simli.ai/LipsyncStream");
      ws_lipsync.binaryType = "arraybuffer";
      ws.current = ws_lipsync;

      ws_lipsync.onopen = () => {
        console.log("Connected to lipsync server");
        ws_lipsync.send(sessionToken);
        playFrameQueue();
      };

      ws_lipsync.onmessage = (event) => {
        if (startTime.current === null) {
          startTime.current = performance.now();
        }

        // console.log("Received data arraybuffer from lipsync server:", event.data);
        // console.log("Received chunk from Lipsync: ", event.data);
        processToVideoAudio(event.data);

        numberOfChunksInQue.current += 1; // Increment chunk size by 1

        return () => {
          if (ws.current) {
            console.error("Closing Lipsync WebSocket");
            ws.current.close();
          }
        };
      };

      return () => {
        console.error("Closing Lipsync WebSocket");
        ws_lipsync.close();
      };
    }, [
      audioContext,
      start,
      // NOTE: these should likely be in the dependency array too
      sessionToken,
      processToVideoAudio,
    ]);

    /* Play video frames queue */
    const playFrameQueue = async () => {
      // Update current frame buffer if there is a new frame
      const frame: ImageFrame | undefined = frameQueue.current.shift();
      // console.log("Frames in queue: ", frameQueue.current.length);

      if (frame === undefined) {
        // console.log("FrameQueue: No frames to play!");
        setTimeout(playFrameQueue, frameInterval);
        return;
      }

      const arrayBuffer =
        frame.imageData;
      const width =
        frame.frameWidth;
      const height =
        frame.frameHeight;

      const blob = new Blob([arrayBuffer]); // Convert ArrayBuffer to Blob
      const url = URL.createObjectURL(blob);

      const image = new Image();
      image.onload = () => {
        videoContext?.clearRect(0, 0, width, height);
        videoContext?.drawImage(image, 0, 0, width, height);
        URL.revokeObjectURL(url); // Clean up memory after drawing the image
      };
      image.src = url;

      setTimeout(playFrameQueue, frameInterval); // Set the next frame draw
    };


    const Uint8ToFloat32 = (incomingData) => { // incoming data is a UInt8Array
      var i, l = incomingData.length;
      var outputData = new Float32Array(incomingData.length);
      for (i = 0; i < l; i++) {
        outputData[i] = (incomingData[i] - 128) / 128.0;
      }
      return outputData;
    }

    const Uint8ToInt16 = (incomingData) => { // incoming data is a UInt8Array
      var i, l = incomingData.length;
      var outputData = new Int16Array(incomingData.length);
      for (i = 0; i < l; i++) {
        outputData[i] = (incomingData[i] - 128) * 256;
      }
      return outputData;
    }

    const updateAudioAndVideoQueue = async (audioData: Uint8Array, imageFrame: ImageFrame) => {

      if (numberOfChunksInQue.current < minimumChunkSize || audioQueue.current.length < minimumChunkSize) {
        // Update Audio Buffer
        audioQueue.current.push(audioData);

        // Update Frame Buffer
        accumulatedFrameBuffer.current.push(imageFrame);
      } else {
        const chunkCollectionTime = (performance.now() - startTime.current).toFixed(2);
        console.log("Chunk collection time:", chunkCollectionTime, "ms",
          "\nMinimum is", 33 * minimumChunkSize, "ms");
        startTime.current = null;


        // pcm-player
        const audioQueueChunks = audioQueue.current;
        console.log("Audio Queue Chunks ", audioQueueChunks);
        audioQueue.current = [];

        audioQueueChunks.forEach(audioChunk => {
          // audioNode.current.port.postMessage(audioChunk);
          audioPCMPlayer.current.feed(audioChunk);
        });

        // Update Frame Queue
        for (let i = 0; i < accumulatedFrameBuffer.current.length; i++) {
          frameQueue.current.push(accumulatedFrameBuffer.current[i]);
        }
        accumulatedFrameBuffer.current = [];

        // Reset chunk size
        numberOfChunksInQue.current = 0;
      }
    };

    const concatenateUint8Arrays = (array1, array2) => {
      let concatenatedArray = new Uint8Array(array1.length + array2.length);
      concatenatedArray.set(array1);
      concatenatedArray.set(array2, array1.length);
      return concatenatedArray;
    }

    const concatenateArrayBuffers = (buffer1, buffer2) => {
      // Create a new ArrayBuffer with a size equal to the sum of the sizes of the two buffers
      let concatenatedBuffer = new ArrayBuffer(buffer1.byteLength + buffer2.byteLength);

      // Create views for each buffer
      let view1 = new Uint8Array(buffer1);
      let view2 = new Uint8Array(buffer2);
      let concatenatedView = new Uint8Array(concatenatedBuffer);

      // Copy the contents of the first buffer to the new buffer
      concatenatedView.set(view1);

      // Copy the contents of the second buffer to the new buffer, starting after the first buffer
      concatenatedView.set(view2, view1.byteLength);

      return concatenatedBuffer;
    }

    const sendSilence = () => {
      const silence = new Uint8Array(1068 * minimumChunkSize);
      ws.current?.send(silence);
      console.log("Sending silence!");
    };

    return <canvas ref={canvasRef} width="512" height="512"></canvas>;
  }
);

export default SimliFaceStream;
