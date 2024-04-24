import React, { useState, useEffect, useRef, use } from "react";

const MIN_DECODE_SIZE = 60000; // Define your custom minimum size for decoding

export default function Home() {
  const [ws, setWs] = useState<WebSocket | null>(null); // WebSocket connection for audio data
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null); // AudioContest for decoding audio data
  const [audioQueue, setAudioQueue] = useState<Array<AudioBuffer>>([]); // Queue for storing decoded audio data
  const [lastAudioDuration, setLastAudioDuration] = useState(0); // Timestamp for the last audio played, used for scheduling
  const [audioPlaying, setAudioPlaying] = useState(false); // State of playing audio
  const accumulatedBuffer = useRef<Array<Uint8Array>>([]); // Buffer for accumulating incoming data until it reaches the minimum size for decoding

  const frameQueue = useRef([]);
  const lastFrameTimeRef = useRef(performance.now());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef();

  /* Create AudioContext at the start */
  useEffect(() => {
    const context = new AudioContext();
    setAudioContext(context);
  }, []);

  /* Connect with Lipsync stream */
  useEffect(() => {
    const ws_lipsync = new WebSocket("ws://34.91.9.107:8892/LipsyncStream");
    setWs(ws_lipsync);

    ws_lipsync.onopen = () => {
      console.log("Connected to lipsync server");
      const metadata = {
        video_reference_url:
          "https://storage.googleapis.com/charactervideos/11c30c18-86c3-424e-bb29-9c6d1fd6003b/11c30c18-86c3-424e-bb29-9c6d1fd6003b.mp4",
        face_det_results:
          "https://storage.googleapis.com/charactervideos/11c30c18-86c3-424e-bb29-9c6d1fd6003b/11c30c18-86c3-424e-bb29-9c6d1fd6003b.pkl",
        isSuperResolution: true,
        isJPG: true,
      };
      ws_lipsync.send(JSON.stringify(metadata));
    };

    ws_lipsync.onmessage = (event) => {
      console.log("Received data blob from lipsync server:", event.data);
      processToVideoAudio(event.data);

      /*
      // <------------------ OLD ------------------>
      // Decode the incoming data as ArrayBuffer and push to audio queue
      // const reader = new FileReader();
      // reader.onload = () => {
      //   const data = reader.result as ArrayBuffer;
      //   if (audioContext) {
      //     processToVideoAudio(data);
      //   }
      // };
      // reader.readAsArrayBuffer(event.data);
      // <------------------ OLD ------------------/>
      */
      requestRef.current = requestAnimationFrame(processFrameQueue);

      return () => {
        if (ws) {
          ws.close();
        }
        cancelAnimationFrame(requestRef.current);
      };
    };

    return () => {
      ws_lipsync.close();
    };
  }, [audioContext]);

  /* Create WebSocket connection and listen for incoming audio broadcast data */
  useEffect(() => {
    const ws_audio = new WebSocket("ws://localhost:9000/audio");

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
    if (audioPlaying && audioQueue && audioQueue.length > 0) {
      playNextAudio();
    } else {
      console.log("AudioQueue is empty or audio is not playing");
    }
  }, [audioQueue, audioPlaying]);

  /* Process Data Bytes to Audio and Video */
  const processToVideoAudio = async (dataBlob: Blob) => {
    const arrayBuffer = await dataBlob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Extracting the endIndex from the message
    const endIndex = new DataView(data.buffer.slice(5, 9)).getUint32(0, true);
    console.log("endIndex:", endIndex);

    // Extracting frame metadata
    const frameIndex = new DataView(data.buffer.slice(0, 4)).getUint32(0, true);
    const frameWidth = new DataView(data.buffer.slice(4, 8)).getUint32(0, true);
    const frameHeight = new DataView(data.buffer.slice(8, 12)).getUint32(
      0,
      true
    );
    const imageData = data.subarray(12); // The rest is image data
    console.log("WebSocket Image data length:", imageData.byteLength);
    
    // Extract Audio data
    const audioData = data.subarray(18 + endIndex);
    console.log("WebSocket Audio data length:", audioData.byteLength);
    
    // Push image data to frame queue
    frameQueue.current.push({ frameWidth, frameHeight, imageData });

    // TODO: Push audio data to audio queue
    // updateAudioQueue(audioData);

    console.warn("");
    /*
    try {
      console.log("Data length:", data.length);

      // Extracting the endIndex from the message
      const endIndex = new DataView(data.buffer.slice(5, 9)).getUint32(0, true); //True if little-endian, false if big-endian
      console.log("endIndex", endIndex);

      // Extracting the video data
      const video = data.buffer.slice(9, endIndex);

      // Extracting frame metadata
      const frameIndex = new DataView(
        data.buffer.slice(0 + 9, 4 + 9)
      ).getUint32(0, true);
      const frameWidth = new DataView(
        data.buffer.slice(4 + 9, 8 + 9)
      ).getUint32(0, true);
      const frameHeight = new DataView(
        data.buffer.slice(8 + 9, 12 + 9)
      ).getUint32(0, true);

      // Extracting image data
      const imageData = data.subarray(12 + 9, endIndex + 9);
      console.log("WebSocket Image data length:", imageData.byteLength);

      // Extract Audio data
      const audioData = data.subarray(18 + endIndex);
      console.log("WebSocket Audio data length:", audioData.byteLength);

      // Decode the incoming data as ArrayBuffer and push to audio queue
      // updateAudioQueue(audioData);

      // Pushing the frame data into a queue
      // frameQueue.current.push({ frameWidth, frameHeight, imageData });
      console.warn("");
    } catch (e) {
      console.error(e);
    }
    */
  };

  /* Play video from buffer */
  const processFrameQueue = () => {
    const now = performance.now();
    const timeSinceLastFrame = now - lastFrameTimeRef.current;
    const msPerFrame = 1000 / 30; // Approximately 33.33 milliseconds per frame

    if (timeSinceLastFrame >= msPerFrame) {
      if (frameQueue.current.length > 0) {
        const { frameWidth, frameHeight, imageData } =
          frameQueue.current.shift();
        const blob = new Blob([imageData], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext("2d");
          canvas.width = frameWidth;
          canvas.height = frameHeight;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
        };
        img.src = url;
        lastFrameTimeRef.current = now;
      }
    }
    requestRef.current = requestAnimationFrame(processFrameQueue);
  };

  /* Decode ArrayBuffer data to Audio and push to audio queue */
  const updateAudioQueue = async (data: ArrayBuffer) => {
    const accumulatedBufferTotalByteLength = accumulatedBuffer.current.reduce(
      (total, array) => total + array.byteLength,
      0
    );

    if (accumulatedBufferTotalByteLength >= MIN_DECODE_SIZE) {
      // 1: Concatenate Uint8Arrays into a single Uint8Array
      const concatenatedData = new Uint8Array(accumulatedBufferTotalByteLength);
      let offset = 0;
      for (const array of accumulatedBuffer.current) {
        concatenatedData.set(array, offset);
        offset += array.byteLength;
      }

      // 2: Reset accumulated data buffer
      accumulatedBuffer.current = [];

      // 3: Decode concatenated data
      const decodedAudioData = await audioContext!.decodeAudioData(
        concatenatedData.buffer
      );

      // 4: Push decoded audio data to the queue
      setAudioQueue((prevQueue) => [...prevQueue, decodedAudioData]);
    } else {
      // Else: Accumulate received data
      if (!accumulatedBuffer.current) {
        accumulatedBuffer.current = [new Uint8Array(data)];
      } else {
        accumulatedBuffer.current.push(new Uint8Array(data));
      }
    }
  };

  /* Schedule play audio in the queue */
  const playNextAudio = async () => {
    const audioData = audioQueue.shift();
    if (!audioData) return;
    const source = audioContext!.createBufferSource();
    source.buffer = audioData;
    source.connect(audioContext!.destination);

    // Calculate the scheduled time using performance.now()
    const currentTime = audioContext!.currentTime; // Convert to seconds
    const delay =
      lastAudioDuration + Math.max(0, currentTime - lastAudioDuration);
    const scheduledTime = delay;

    // Schedule playback at the correct time
    source.start(scheduledTime);

    // Update timestamp for the next audio
    setLastAudioDuration((prev) => prev + audioData!.duration);

    console.log(
      `Playing next audio: CurrentTime: ${currentTime.toFixed(
        2
      )}  AudioDuration: ${audioData!.duration.toFixed(
        2
      )} ScheduledTime ${scheduledTime.toFixed(2)}`
    );
  };

  const handlePauseAudio = () => {
    setAudioPlaying(false);
    audioContext!.suspend();
  };

  const handleResumeAudio = () => {
    setAudioPlaying(true);
    audioContext!.resume();
  };

  /* Test function to send data to websocket */
  // const handleSendData = () => {
  //   if (!ws) return;
  //   const buffer = new ArrayBuffer(32000);
  //   const view = new Uint8Array(buffer);
  //   view.fill(4);
  //   console.log("Sending data to server:", buffer);
  //   ws.send(buffer);
  // };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 font-mono">
      <canvas
        ref={canvasRef}
        width="512"
        height="512"
        style={{ border: "1px solid black" }}
      ></canvas>
      <p>Click the button 👇</p>
      <div
        className="relative group hover:cursor-pointer"
        onClick={() => {
          audioPlaying ? handlePauseAudio() : handleResumeAudio();
        }}
      >
        <div
          className={
            "absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 w-[102px] h-[102px] rounded-full transition-all group-active:w-[50px] group-active:bg-white group-hover:opacity-80 " +
            (audioPlaying ? "bg-lime-700" : "bg-slate-500")
          }
        ></div>
      </div>
      <div>
        <p>Audio Queue Length: {audioQueue.length}</p>
        <p>State: {audioPlaying ? "Playing" : "Paused"}</p>
        <p>
          currentTime: {audioContext && audioContext!.currentTime.toFixed(2)}
        </p>
      </div>

      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex"></div>
    </main>
  );
}
