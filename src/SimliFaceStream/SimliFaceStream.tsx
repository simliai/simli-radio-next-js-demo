import React, {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react';

import PCMPlayer from './pcm-player';

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
    SimliFaceStream.displayName = 'SimliFaceStream';

    const ws = useRef<WebSocket | null>(null); // WebSocket connection for audio data
    const startTime = useRef<any>();
    const chunkCollectionTime = useRef<any>();
    const numberOfChunksInQue = useRef<number>(0); // Number of buffered chunks in queue waiting to be decoded

    // ------------------- AUDIO -------------------
    const audioPCMPlayer = useRef<PCMPlayer | null>(null); // Ref for audio PCM player
    const audioContext = useRef<AudioContext | null>(null); // Ref for audio context
    const audioQueue = useRef<Array<Uint8Array>>([]); // Ref for audio queue
    const isSilent = useRef<boolean>(false);
    const silenceTime = useRef<any>(); // Silence time for audio data

    // ------------------- VIDEO -------------------
    const frameQueue = useRef<Array<Array<ImageFrame>>>([]); // Queue for storing video data
    const currentFrameQueue = useRef<Array<ImageFrame>>([]); // Current frame queue
    const currentFrameIndex = useRef<number>(0); // Current frame index
    const accumulatedFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [videoContext, setVideoContext] =
      useState<CanvasRenderingContext2D | null>(null);
    const frameInterval = 33.375; // Time between frames in milliseconds

    useEffect(() => {
      setInterval(() => {
        const timeDifference = performance.now() - silenceTime.current;
        if (
          isSilent.current === true &&
          silenceTime !== null &&
          timeDifference > frameInterval * minimumChunkSize
        ) {
          console.log('Time difference:', timeDifference, 'ms');
          sendSilence();
          silenceTime.current = performance.now();
        }
      }, 10);
    }, []);

    const handlePCMPlayerOnstart = () => {
      // Start recording silence time
      silenceTime.current = performance.now();

      // Play video from queue
      playFrameQueue();
    };

    const handlePCMPlayerOnended = () => {
      // console.log("Audio chunk ended playback!");
    };

    /* Create AudioContext at the start */
    useEffect(() => {
      // Return if start is false
      if (start === false) return;

      // Return if sessionToken is empty or not correct
      if (sessionToken.length < 20) {
        console.error('Error in session token:', sessionToken);
        return;
      }

      // Initialize PCMPlayer
      audioPCMPlayer.current = new PCMPlayer({
        inputCodec: 'Int16',
        channels: 1,
        sampleRate: 16000,
        flushTime: frameInterval,
        fftSize: 32,
        silenceThreshold: frameInterval * (minimumChunkSize + 2),
        onstart() {
          handlePCMPlayerOnstart();
        },
        onended() {
          handlePCMPlayerOnended();
        },
        onsilent() {
          if (isSilent.current === false) {
            isSilent.current = true;
          }
        },
      });
      audioPCMPlayer.current.volume(1.0);

      // Intialize VideoContext
      const videoCanvas = canvasRef.current;
      if (videoCanvas) {
        setVideoContext(videoCanvas?.getContext('2d'));
        console.log('VideoContext created');
      }
    }, [start, handlePCMPlayerOnended, handlePCMPlayerOnstart]);

    const sendAudioDataToLipsync = (audioData: Uint8Array) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(audioData);
        isSilent.current = false;
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
      checkIfChunkSizeReached(audioDataUint8, imageFrame);

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
    };

    /* Play video frames queue */
    const playFrameQueue = async () => {
      // Update current frame buffer if there is a new frame
      if (currentFrameIndex.current === 0) {
        const frame: ImageFrame[] | undefined = frameQueue.current.shift();
        currentFrameQueue.current = frame;
      }

      if (
        currentFrameQueue.current === undefined ||
        currentFrameIndex.current >= minimumChunkSize
      ) {
        // console.log("FrameQueue: No frames to play!");
        currentFrameIndex.current = 0;
        // setTimeout(playFrameQueue, 10);
        return;
      }

      const arrayBuffer =
        currentFrameQueue.current[currentFrameIndex.current].imageData;
      const width =
        currentFrameQueue.current[currentFrameIndex.current].frameWidth;
      const height =
        currentFrameQueue.current[currentFrameIndex.current].frameHeight;

      const blob = new Blob([arrayBuffer]); // Convert ArrayBuffer to Blob
      const url = URL.createObjectURL(blob);

      const image = new Image();
      image.onload = () => {
        videoContext?.clearRect(0, 0, width, height);
        videoContext?.drawImage(image, 0, 0, width, height);
        URL.revokeObjectURL(url); // Clean up memory after drawing the image
      };
      image.src = url;
      currentFrameIndex.current += 1;

      setTimeout(playFrameQueue, frameInterval); // Set the next frame draw
    };

    /* Connect with Lipsync stream */
    useEffect(() => {
      // Return if start is false
      if (start === false) return;

      const ws_lipsync = new WebSocket('wss://api.simli.ai/LipsyncStream');
      ws_lipsync.binaryType = 'arraybuffer';
      ws.current = ws_lipsync;

      ws_lipsync.onopen = () => {
        console.log('Connected to lipsync server');
        ws_lipsync.send(sessionToken);
      };

      return () => {
        console.error('Closing Lipsync WebSocket');
        ws_lipsync.close();
      };
    }, [audioContext, start, sessionToken]);

    useEffect(() => {
      if (ws.current === null) return;

      ws.current.onmessage = (event) => {
        if (startTime.current === null) {
          startTime.current = performance.now();
        }

        // console.log("Received data arraybuffer from lipsync server:", event.data);
        processToVideoAudio(event.data);

        numberOfChunksInQue.current += 1; // Increment chunk size by 1

        return () => {
          if (ws.current) {
            console.error('Closing Lipsync WebSocket');
            ws.current.close();
          }
        };
      };
    }, [ws.current, processToVideoAudio]);

    const checkIfChunkSizeReached = async (
      audioData: Uint8Array,
      imageFrame: ImageFrame
    ) => {
      // Didn't reach the minimum chunk size
      if (
        numberOfChunksInQue.current < minimumChunkSize ||
        audioQueue.current.length < minimumChunkSize
      ) {
        // Update Audio Buffer
        audioQueue.current.push(audioData);

        // Update Frame Buffer
        accumulatedFrameBuffer.current.push(imageFrame);
      }
      // Reached the minimum chunk size
      else {
        updateQueue();
      }
    };

    const updateQueue = () => {
      chunkCollectionTime.current = (
        performance.now() - startTime.current
      ).toFixed(2);

      console.log(
        'Chunk collection time:',
        chunkCollectionTime.current,
        'ms',
        '\nMinimum is',
        frameInterval * minimumChunkSize,
        'ms'
      );
      startTime.current = null;

      // Update Frame Queue
      frameQueue.current.push(accumulatedFrameBuffer.current);
      accumulatedFrameBuffer.current = [];

      // pcm-player
      const audioQueueChunks = audioQueue.current;
      audioQueue.current = [];

      audioQueueChunks.forEach((audioChunk) => {
        audioPCMPlayer.current.feed(audioChunk);
      });

      // Reset chunk size
      numberOfChunksInQue.current = 0;
    };

    const sendSilence = () => {
      // 1068 bytes is the size of 1 audio sample chunk
      const silence = new Uint8Array(1068 * minimumChunkSize);
      ws.current?.send(silence);
      console.log('Sending silence!');
    };

    return <canvas ref={canvasRef} width='512' height='512'></canvas>;
  }
);

export default SimliFaceStream;
