import React, { useState, useEffect, useRef, use } from "react";

// Minimum chunk size for decoding,
// Higher chunk size will result in longer delay but smoother playback
// ( 1 chunk = 0.03 seconds )
// ( 30 chunks = 0.9 seconds )
const MIN_CHUNK_SIZE = 20;

interface ImageFrame {
  frameWidth: number;
  frameHeight: number;
  imageData: Uint8Array;
}

export default function Home() {
  const [ws, setWs] = useState<WebSocket | null>(null); // WebSocket connection for audio data
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null); // AudioContest for decoding audio data
  const [audioQueue, setAudioQueue] = useState<Array<AudioBuffer>>([]); // Queue for storing decoded audio data
  const [lastAudioDuration, setLastAudioDuration] = useState(0); // Timestamp for the last audio played, used for scheduling
  const [playing, setPlaying] = useState(false); // State of playing audio
  const accumulatedAudioBuffer = useRef<Array<Uint8Array>>([]); // Buffer for accumulating incoming data until it reaches the minimum size for decoding

  const frameQueue = useRef<Array<Array<ImageFrame>>>([]); // Queue for storing video data
  const accumulatedFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
  const currentFrameBuffer = useRef<Array<ImageFrame>>([]); // Buffer for accumulating incoming video data
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoContext, setVideoContext] =
    useState<CanvasRenderingContext2D | null>(null);
  const currentFrame = useRef(0);
  const fps = 29;
  const frameInterval = 1000 / fps; // Calculate the time between frames in milliseconds

  const lastFrameTimeRef = useRef(performance.now());
  const requestRef = useRef<number>();

  const currentChunkSize = useRef<number>(0); // Current chunk size for decoding

  /* Main loop */
  // TODO: playback on useEffect is not getting called accurately
  useEffect(() => {
    if (playing && audioQueue.length > 0 && frameQueue.current.length > 0) {
      // requestRef.current = requestAnimationFrame(playFrameQueue);
      currentFrameBuffer.current = frameQueue.current.shift();
      drawFrame();
      playAudioQueue();
    }

    return () => {
      cancelAnimationFrame(requestRef.current!);
    };
  }, [playing, currentChunkSize.current]);

  /* Create AudioContext at the start */
  useEffect(() => {
    // Initialize AudioContext
    const newAudioContext = new AudioContext();
    setAudioContext(newAudioContext);

    // Intialize VideoContext
    const videoCanvas = canvasRef.current;
    if (videoCanvas) {
      setVideoContext(videoCanvas?.getContext("2d"));
    }
  }, []);

  /* Connect with Lipsync stream */
  useEffect(() => {
    const ws_lipsync = new WebSocket("ws://34.91.9.107:8892/LipsyncStream");
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
      // console.log("Received data arraybuffer from lipsync server:", event.data);
      processToVideoAudio(event.data);

      currentChunkSize.current += 1; // Increment chunk size by 1

      return () => {
        if (ws) {
          ws.close();
        }
      };
    };

    return () => {
      ws_lipsync.close();
    };
  }, [audioContext, currentChunkSize.current]);

  /* Create WebSocket connection and listen for incoming audio broadcast data */
  useEffect(() => {
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
        // console.log("Sent data to lipsync server:", event.data);
      }
    };

    return () => {
      ws_audio.close();
    };
  }, [audioContext, ws]);

  /* Keep listening to audio queue updates and play them */
  // useEffect(() => {
  //   // console.log("AudioQueue:", audioQueue.length);
  //   if (playing && audioQueue && audioQueue.length > 0) {
  //     playAudioQueue();
  //   } else {
  //     console.log("AudioQueue is empty or audio is not playing");
  //   }
  // }, [audioQueue, playing]);

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

    // --------------- LOGGING ----------------

    // Log Everything
    // console.log(
    //   `${videoMessage}: ${imageData.byteLength}\n` +
    //     `${audioMessage}: ${audioData.byteLength}\n` +
    //     `endIndex: ${endIndex}`
    // );
    // console.warn("");
  };

  function drawFrame() {
    if (currentFrame.current >= currentFrameBuffer.current.length) {
      // currentFrame = 0; // Loop the video
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
  }

  /* Play video from buffer */
  /* ------------------- OLD ------------------- */
  // const playFrameQueue = () => {
  //   const now = performance.now();
  //   const timeSinceLastFrame = now - lastFrameTimeRef.current;
  //   const msPerFrame = 1000 / 30;

  //   if (timeSinceLastFrame < msPerFrame || frameQueue.current.length === 0) {
  //     requestRef.current = requestAnimationFrame(playFrameQueue);
  //     return;
  //   }

  //   const { frameWidth, frameHeight, imageData } = frameQueue.current.shift();
  //   const blob = new Blob([imageData], { type: "image/jpeg" });
  //   const url = URL.createObjectURL(blob);

  //   const img = new Image();
  //   img.onload = () => {
  //     const canvas = canvasRef.current;
  //     const ctx = canvas!.getContext("2d");
  //     canvas!.width = frameWidth;
  //     canvas!.height = frameHeight;
  //     ctx!.drawImage(img, 0, 0, canvas!.width, canvas!.height);
  //     URL.revokeObjectURL(url);
  //   };

  //   img.src = url;
  //   lastFrameTimeRef.current = now;

  //   requestRef.current = requestAnimationFrame(playFrameQueue);
  // };
  /* ------------------- OLD ------------------- */

  /* Update video queue */
  const updateFrameQueue = (imageFrame: ImageFrame) => {
    if (currentChunkSize.current >= MIN_CHUNK_SIZE) {
      frameQueue.current.push(accumulatedFrameBuffer.current);
      accumulatedFrameBuffer.current = [];
    } else {
      accumulatedFrameBuffer.current.push(imageFrame);
    }
  };

  /* Decode ArrayBuffer data to Audio and push to audio queue */
  const updateAudioQueue = async (data: ArrayBuffer) => {
    console.log("Current Chunk Size:", currentChunkSize);
    if (currentChunkSize.current >= MIN_CHUNK_SIZE) {
      console.error("CHUNK SIZE REACHED", currentChunkSize);
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

  /* ------------------ OLD ------------------ */
  // /* Helper function to decode ArrayBuffer as PCM16 */
  // const decodeAudioDataAsPCM16 = (buffer: Uint8Array): Promise<AudioBuffer> => {
  //   return new Promise((resolve, reject) => {
  //     if (!audioContext) {
  //       reject(new Error("AudioContext is not available."));
  //       return;
  //     }

  //     const audioBuffer = audioContext.createBuffer(1, buffer.length, 16000);
  //     audioBuffer.getChannelData(0).set(buffer);

  //     console.warn("Decoded audio data as PCM16");
  //     resolve(audioBuffer);
  //   });
  // };
  /* ------------------ OLD ------------------ */

  /* Schedule play audio in the queue */
  const playAudioQueue = async () => {
    const audioBuffer = audioQueue.shift();
    if (!audioBuffer) return;

    const source = audioContext!.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext!.destination);

    // Calculate the scheduled time using performance.now()
    const currentTime = audioContext!.currentTime; // Convert to seconds
    const delay =
      lastAudioDuration + Math.max(0, currentTime - lastAudioDuration);
    const scheduledTime = delay;

    // Schedule playback at the correct time
    source.start(0);

    // Update timestamp for the next audio
    setLastAudioDuration((prev) => prev + audioBuffer!.duration);

    console.log(
      `Playing next audio: CurrentTime: ${currentTime.toFixed(
        2
      )}  AudioDuration: ${audioBuffer!.duration.toFixed(
        2
      )} ScheduledTime ${scheduledTime.toFixed(2)}`
    );
  };

  const handlePauseAudio = () => {
    setPlaying(false);
    audioContext!.suspend();
  };

  const handleResumeAudio = () => {
    setPlaying(true);
    audioContext!.resume();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 font-mono">
      <canvas
        ref={canvasRef}
        width="512"
        height="512"
        style={{ border: "1px solid black" }}
      ></canvas>
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
      <div>
        <p>Chunk size: {currentChunkSize.current}</p>
        <p>Frame Queue Length: {frameQueue.current.length}</p>
        <p>Audio Queue Length: {audioQueue.length}</p>
        <br />
        <p>Playback Delay: {(MIN_CHUNK_SIZE * 0.03).toFixed(2)} seconds</p>
      </div>

      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex"></div>
    </main>
  );
}
