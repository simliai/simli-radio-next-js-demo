import React, { useState, useEffect, useRef, use } from "react";

//const MIN_DECODE_SIZE = 1068 * 30; // Define your custom minimum size for decoding
const MIN_CHUNK_SIZE = 40; // Minimum chunk size for decoding

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
  const accumulatedBuffer = useRef<Array<Uint8Array>>([]); // Buffer for accumulating incoming data until it reaches the minimum size for decoding

  const frameQueue = useRef<Array<ImageFrame>>([]); // Queue for storing video data
  const lastFrameTimeRef = useRef(performance.now());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();

  const currentChunkSize = useRef<number>(0); // Current chunk size for decoding

  /* Main loop */
  useEffect(() => {
    if (playing) {
      requestRef.current = requestAnimationFrame(processFrameQueue);
    }

    return () => {
      cancelAnimationFrame(requestRef.current!);
    };
  }, [playing, currentChunkSize]);

  /* Create AudioContext at the start */
  useEffect(() => {
    const context = new AudioContext();
    setAudioContext(context);
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
  }, [audioContext, currentChunkSize]);

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
  useEffect(() => {
    // console.log("AudioQueue:", audioQueue.length);
    if (playing && audioQueue && audioQueue.length > 0) {
      playNextAudio();
    } else {
      console.log("AudioQueue is empty or audio is not playing");
    }
  }, [audioQueue, playing]);

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

  /* Play video from buffer */
  const processFrameQueue = () => {
    const now = performance.now();
    const timeSinceLastFrame = now - lastFrameTimeRef.current;
    const msPerFrame = 1000 / 30;

    if (timeSinceLastFrame < msPerFrame || frameQueue.current.length === 0) {
      requestRef.current = requestAnimationFrame(processFrameQueue);
      return;
    }

    const { frameWidth, frameHeight, imageData } = frameQueue.current.shift();
    const blob = new Blob([imageData], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas!.getContext("2d");
      canvas!.width = frameWidth;
      canvas!.height = frameHeight;
      ctx!.drawImage(img, 0, 0, canvas!.width, canvas!.height);
      URL.revokeObjectURL(url);
    };

    img.src = url;
    lastFrameTimeRef.current = now;

    requestRef.current = requestAnimationFrame(processFrameQueue);
  };

  /* Update video queue */
  const updateFrameQueue = (imageFrame: ImageFrame) => {
    frameQueue.current.push(imageFrame);
  };

  /* Decode ArrayBuffer data to Audio and push to audio queue */
  const updateAudioQueue = async (data: ArrayBuffer) => {
    console.log("Current Chunk Size:", currentChunkSize);
    if (currentChunkSize.current >= MIN_CHUNK_SIZE) {
      console.error("CHUNK SIZE REACHED", currentChunkSize);
      // 1: Concatenate Uint8Arrays into a single Uint8Array
      const accumulatedBufferTotalByteLength = accumulatedBuffer.current.reduce(
        (total, array) => total + array.byteLength,
        0
      );
      const concatenatedData = new Uint8Array(accumulatedBufferTotalByteLength);
      let offset = 0;
      for (const array of accumulatedBuffer.current) {
        concatenatedData.set(array, offset);
        offset += array.byteLength;
      }

      // 2: Reset accumulated data buffer
      accumulatedBuffer.current = [];

      // 3: Decode concatenated data as PCM16 audio
      const decodedAudioData = await createAudioBufferFromPCM16(
        concatenatedData
      );

      /* ------------------ OLD ------------------ */
      // // 3: Decode concatenated data as MP3 audio
      // const decodedAudioData = await audioContext!.decodeAudioData(
      //   concatenatedData.buffer
      // );
      /* ------------------ OLD ------------------ */

      // 4: Push decoded audio data to the queue
      setAudioQueue((prevQueue) => [...prevQueue, decodedAudioData]);

      currentChunkSize.current = 0; // Reset chunk size
    } else {
      // Else: Accumulate received data
      if (!accumulatedBuffer.current) {
        accumulatedBuffer.current = [new Uint8Array(data)];
      } else {
        accumulatedBuffer.current.push(new Uint8Array(data));
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
  const playNextAudio = async () => {
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
    source.start(scheduledTime);

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
        <p>Chunk Size: {currentChunkSize.current}</p>
        <p>Frame Queue Length: {frameQueue.current.length}</p>
        <p>Audio Queue Length: {audioQueue.length}</p>
        <p>State: {playing ? "Playing" : "Paused"}</p>
        <p>
          currentTime: {audioContext && audioContext!.currentTime.toFixed(2)}
        </p>
      </div>

      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex"></div>
    </main>
  );
}
