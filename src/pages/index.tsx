import React, { useState, useEffect, useRef, use } from "react";

const MIN_DECODE_SIZE = 60000; // Define the minimum size for decoding

export default function Home() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [audioQueue, setAudioQueue] = useState<Array<AudioBuffer>>([]);
  const [lastAudioDuration, setLastAudioDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const accumulatedBuffer = useRef<Array<Uint8Array>>([]);

  /* Create AudioContext at the start */
  useEffect(() => {
    const context = new AudioContext();
    setAudioContext(context);
  }, []);

  /* Create WebSocket connection and listen for incoming data */
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:9000/audio");
    setWs(ws);

    ws.onopen = () => {
      console.log("Connected to server");
    };

    ws.onmessage = (event) => {
      // console.log("Received data from server:", event.data);

      // Decode the incoming data as ArrayBuffer and push to audio queue
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as ArrayBuffer;
        if (audioContext) {
          updateAudioQueue(data);
        }
      };
      reader.readAsArrayBuffer(event.data);
    };

    return () => {
      ws.close();
    };
  }, [audioContext]);

  /* Keep listening to audio queue updates and play them */
  useEffect(() => {
    // console.log("AudioQueue:", audioQueue.length);
    if (audioPlaying && audioQueue && audioQueue.length > 0) {
      playNextAudio();
    } else {
    }
  }, [audioQueue, audioPlaying]);

  
  let isBufferDetached = false; // Flag to track buffer detachment

  let isAudioPlaying = false; // Flag to track audio playback


  /* Accumlate data to buffer */
  const accumulateBuffer = (data: ArrayBuffer) => {

  };

  /* Decode ArrayBuffer data to Audio and push to audio queue */
  const updateAudioQueue = async (data: ArrayBuffer) => {

    const accumulatedBufferTotalByteLength = accumulatedBuffer.current.reduce((total, array) => total + array.byteLength, 0);
    if (accumulatedBufferTotalByteLength>= MIN_DECODE_SIZE) {

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
      const decodedAudioData = await audioContext!.decodeAudioData(concatenatedData.buffer);
  
      // 4: If audio is not currently playing, add the decoded audio data to the queue
      if (!isAudioPlaying) {
        setAudioQueue((prevQueue) => [...prevQueue, decodedAudioData]);
      }

    }else
    {
      // Accumulate received data
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
      <p>Hello</p>
      <div
        className="relative group hover:cursor-pointer"
        onClick={() => {
          audioPlaying ? setAudioPlaying(false) : setAudioPlaying(true);
        }}
      >
        <p className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 z-10 text-center">
          Audio Queue {audioQueue.length}
        </p>
        <div
          className={
            "absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 w-[102px] h-[102px] rounded-full transition-all group-active:w-[50px] group-active:bg-white group-hover:opacity-80 " +
            (audioPlaying ? "bg-lime-700" : "bg-slate-500")
          }
        ></div>
      </div>
      <p className="text-center">
        {audioPlaying ? "Audio Scheduling" : "Audio Not Scheduling"}
      </p>
      <p>{audioContext && audioContext!.currentTime}</p>

      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex"></div>
    </main>
  );
}
