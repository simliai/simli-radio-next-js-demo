import React, { useState, useEffect, useRef, use } from "react";

// Minimum chunk size for decoding,
// Higher chunk size will result in longer delay but smoother playback
// ( 1 chunk = 0.033 seconds )
// ( 30 chunks = 0.9 seconds )
const MIN_CHUNK_SIZE = 30;

interface ImageFrame {
  frameWidth: number;
  frameHeight: number;
  imageData: Uint8Array;
}

export default function Home() {
  const [start, setStart] = useState(false); // Start button state

  const [ws, setWs] = useState<WebSocket | null>(null); // WebSocket connection for audio data
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null); // AudioContest for decoding audio data
  const [audioQueue, setAudioQueue] = useState<Array<AudioBuffer>>([]); // Queue for storing decoded audio data
  const [playing, setPlaying] = useState(false); // State of playing audio
  const accumulatedAudioBuffer = useRef<Array<Uint8Array>>([]); // Buffer for accumulating incoming data until it reaches the minimum size for decoding

  const frameQueue = useRef<Array<Array<ImageFrame>>>([]); // Queue for storing video data
  const accumulatedFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
  const currentFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoContext, setVideoContext] =
    useState<CanvasRenderingContext2D | null>(null);
  const currentFrame = useRef(0);
  const fps = 30;
  // const frameInterval = 1000 / fps; // Calculate the time between frames in milliseconds
  const frameInterval = 30; // Time between frames in milliseconds (30 seems to work nice)

  const startTime = useRef<any>();
  const executionTime = useRef<any>();
  const averageExecutionTime = useRef<any>();

  const currentChunkSize = useRef<number>(0); // Current chunk size for decoding

  /* Main loop */
  // TODO: playback on useEffect is not getting called accurately
  useEffect(() => {
    playback();
  }, [playing, audioQueue]);

  /* Create AudioContext at the start */
  useEffect(() => {
    // Return if start is false
    if (start === false) return;

    // Initialize AudioContext
    const newAudioContext = new AudioContext();
    setAudioContext(newAudioContext);

    // Intialize VideoContext
    const videoCanvas = canvasRef.current;
    if (videoCanvas) {
      setVideoContext(videoCanvas?.getContext("2d"));
    }

  }, [start]);

  /* Connect with Lipsync stream */
  useEffect(() => {
    // Return if start is false
    if (start === false) return;

    const ws_lipsync = new WebSocket("ws://api.simli.ai/LipsyncStream");
    ws_lipsync.binaryType = "arraybuffer";
    setWs(ws_lipsync);

    ws_lipsync.onopen = () => {
      console.log("Connected to lipsync server");
      const metadata = {
        video_reference_url:
          "https://storage.googleapis.com/charactervideos/tmp9i8bbq7c/tmp9i8bbq7c.mp4",
        face_det_results:
          "https://storage.googleapis.com/charactervideos/tmp9i8bbq7c/tmp9i8bbq7c.pkl",
        isSuperResolution: true,
        isJPG: true,
        syncAudio: true,
      };
      ws_lipsync.send(JSON.stringify(metadata));
    };

    ws_lipsync.onmessage = (event) => {
      if (startTime.current === null) {
        startTime.current = performance.now();
      }

      // console.log("Received data arraybuffer from lipsync server:", event.data);
      processToVideoAudio(event.data);

      currentChunkSize.current += 1; // Increment chunk size by 1

      return () => {
        if (ws) {
          console.error("Closing Lipsync WebSocket");
          ws.close();
        }
      };
    };

    return () => {
      console.error("Closing Lipsync WebSocket");
      ws_lipsync.close();
    };
  }, [audioContext]);

  /* Create WebSocket connection and listen for incoming audio broadcast data */
  useEffect(() => {
    // Return if start is false
    if (start === false) return;

    const ws_audio = new WebSocket("ws://localhost:9000/audio");
    ws_audio.binaryType = "arraybuffer";

    ws_audio.onopen = () => {
      console.log("Connected to audio server");
    };

    ws_audio.onmessage = (event) => {
      // console.log("Received data from server:", event.data);

      // Wait for ws to OPEN and send a message to the server
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(event.data);

        // Send zeros to lipsync server for silence
        // const zeroData = new Uint8Array(4096);
        // ws.send(zeroData.buffer);
      }
    };

    return () => {
      console.error("Closing Audio WebSocket");
      ws_audio.close();
    };
  }, [audioContext, ws]);

  async function playback() {
    if (playing && audioQueue.length > 0) {
      playFrameQueue();
      playAudioQueue();
    }
  };

  /* Process Data Bytes to Audio and Video */
  const processToVideoAudio = async (dataArrayBuffer: ArrayBuffer) => {
    let data = new Uint8Array(dataArrayBuffer);

    // Extracting the endIndex from the message
    const endIndex = new DataView(data.buffer.slice(5, 9)).getUint32(0, true);

    // --------------- VIDEO DATA ----------------

    // Print first 5 bytes of the message as string
    const videoMessage = new TextDecoder().decode(data.slice(0, 5));

    // Extracting frame metadata
    const frameIndex = new DataView(data.buffer.slice(0 + 9, 4 + 9)).getUint32(
      0,
      true
    );
    const frameWidth = new DataView(data.buffer.slice(4 + 9, 8 + 9)).getUint32(
      0,
      true
    );
    const frameHeight = new DataView(
      data.buffer.slice(8 + 9, 12 + 9)
    ).getUint32(0, true);
    const imageData = data.subarray(12 + 9, endIndex + 9); // The rest is image data

    // Push image data to frame queue
    const imageFrame: ImageFrame = { frameWidth, frameHeight, imageData };
    updateFrameQueue(imageFrame);

    // --------------- AUDIO DATA ----------------

    const audioMessage = new TextDecoder().decode(
      data.slice(endIndex + 9, endIndex + 14)
    );

    // Extract Audio data
    const audioData = data.subarray(endIndex + 18);

    // Push audio data to audio queue
    updateAudioQueue(audioData);

    console.log("Received chunk from Lipsync");

    // --------------- LOGGING ----------------

    // Log Everything
    // console.log(
    //   `${videoMessage}: ${imageData.byteLength}\n` +
    //     `${audioMessage}: ${audioData.byteLength}\n` +
    //     `endIndex: ${endIndex}`
    // );
    // console.warn("");
  };

  /* Play video frames queue */
  const playFrameQueue = async () => {
    currentFrameBuffer.current = frameQueue.current.shift();

    const drawFrame = async () => {
      if (currentFrame.current >= currentFrameBuffer.current.length) {
        currentFrame.current = 0;
        return;
      }
  
      const arrayBuffer =
        currentFrameBuffer.current[currentFrame.current].imageData;
      const width = currentFrameBuffer.current[currentFrame.current].frameWidth;
      const height = currentFrameBuffer.current[currentFrame.current].frameHeight;
  
      const blob = new Blob([arrayBuffer]); // Convert ArrayBuffer to Blob
      const url = URL.createObjectURL(blob);
  
      const image = new Image();
      image.onload = () => {
        videoContext?.clearRect(0, 0, width, height);
        videoContext?.drawImage(image, 0, 0, width, height);
        URL.revokeObjectURL(url); // Clean up memory after drawing the image
      };
      image.src = url;
  
      currentFrame.current++;
      setTimeout(drawFrame, frameInterval); // Set the next frame draw
    };
  
    await drawFrame();
  }

  /* Update video queue */
  const updateFrameQueue = async (imageFrame: ImageFrame) => {
    if (currentChunkSize.current >= MIN_CHUNK_SIZE) {
      frameQueue.current.push(accumulatedFrameBuffer.current);
      accumulatedFrameBuffer.current = [];
    } else {
      accumulatedFrameBuffer.current.push(imageFrame);
    }
  };

  /* Decode ArrayBuffer data to Audio and push to audio queue */
  const updateAudioQueue = async (data: ArrayBuffer) => {
    if (currentChunkSize.current >= MIN_CHUNK_SIZE) {
      console.log("--------- CHUNK SIZE REACHED", currentChunkSize);

      // 1: Concatenate Uint8Arrays into a single Uint8Array
      const accumulatedAudioBufferTotalByteLength =
        accumulatedAudioBuffer.current.reduce(
          (total, array) => total + array.byteLength,
          0
        );
      const concatenatedData = new Uint8Array(
        accumulatedAudioBufferTotalByteLength
      );
      let offset = 0;
      for (const array of accumulatedAudioBuffer.current) {
        concatenatedData.set(array, offset);
        offset += array.byteLength;
      }

      // 2: Reset accumulated data buffer
      accumulatedAudioBuffer.current = [];

      // 3: Decode concatenated data as PCM16 audio
      const decodedAudioData = await createAudioBufferFromPCM16(
        concatenatedData
      );

      // 4: Push decoded audio data to the queue
      setAudioQueue((prevQueue) => [...prevQueue, decodedAudioData]);

      currentChunkSize.current = 0; // Reset chunk size
    } else {
      // Else: Accumulate received data
      if (!accumulatedAudioBuffer.current) {
        accumulatedAudioBuffer.current = [new Uint8Array(data)];
      } else {
        accumulatedAudioBuffer.current.push(new Uint8Array(data));
      }
    }
  };

  /* Helper function to decode ArrayBuffer as PCM16 */
  async function createAudioBufferFromPCM16(
    input: Uint8Array
  ): Promise<AudioBuffer> {
    // Ensure the input byte length is even
    if (input.length % 2 !== 0) throw new Error("Input length must be even");

    const numSamples = input.length / 2;
    const audioBuffer = audioContext!.createBuffer(1, numSamples, 16000);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0, j = 0; i < input.length; i += 2, j++) {
      // Little-endian byte order
      let int16 = (input[i + 1] << 8) | input[i];
      // Convert from uint16 to int16
      if (int16 >= 0x8000) int16 |= ~0xffff;
      // Normalize to range -1.0 to 1.0
      channelData[j] = int16 / 32768.0;
    }

    return audioBuffer;
  }

  /* Play audio in the queue */
  const playAudioQueue = async () => {
    const audioBuffer = audioQueue.shift();
    if (!audioBuffer) return;

    const source = audioContext!.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext!.destination);

    executionTime.current = performance.now() - startTime.current;
    console.log("Execution Time:", executionTime.current / 1000, "seconds");
    startTime.current = null;
    executionTime.current = 0;

    // Start playback
    source.start(0);

    console.log(
      `Playing audio: AudioDuration: ${audioBuffer!.duration.toFixed(2)}`
    );
  };

  const handlePauseAudio = () => {
    setPlaying(false);
    // audioContext!.suspend();
  };

  const handleResumeAudio = () => {
    setPlaying(true);
    // audioContext!.resume();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 font-mono">
      {!start ? (
        <button
          onClick={() => setStart(true)}
          className="hover:opacity-75 text-white font-bold py-2 w-[300px] px-4 rounded bg-slate-500"
        >
          Start
        </button>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            width="512"
            height="512"
            style={{ border: "1px solid black" }}
          ></canvas>
          <br />
          <button
            className={
              "hover:opacity-75 text-white font-bold py-2 w-[300px] px-4 rounded" +
              (playing ? " bg-red-500" : " bg-green-500")
            }
            onClick={() => {
              playing ? handlePauseAudio() : handleResumeAudio();
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <br />
          <div>
            <p>Chunk size: {currentChunkSize.current}</p>
            <p>Frame Queue Length: {frameQueue.current.length}</p>
            <p>Audio Queue Length: {audioQueue.length}</p>
            <br />
            <p>Playback Delay: {(MIN_CHUNK_SIZE * 0.033).toFixed(2)} seconds</p>
          </div>

          <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex"></div>
        </>
      )}
    </main>
  );
}
