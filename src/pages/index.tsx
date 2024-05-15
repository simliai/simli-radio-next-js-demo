'use client';
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import SimliFaceStream from "./SimliFaceStream";

export default function Home() {
  const [start, setStart] = useState(false);
  const [playing, setPlaying] = useState(false); // State of playing audio
  const [audioData, setAudioData] = useState(new Uint8Array());

  const simliFaceStreamRef = useRef(null);

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
      if(simliFaceStreamRef.current)
        {
          simliFaceStreamRef.current.sendAudioDataToLipsync(event.data);
        }
      setAudioData(event.data);
      console.log("ping");

    };

    return () => {
      console.error("Closing Audio WebSocket");
      ws_audio.close();
    };
  }, [start]);

  const handleStart = () => {
    setStart(true);
  };

  const handleStop = () => {
    setStart(false);
  };

  // const handleMinimumChunkSizeChange = (event: any) => {
  //   setPlaying(false);
  //   minimumChunkSize.current = parseInt(event.target.value);
  //   setMinimumChunkSizeState(minimumChunkSize.current);
  // };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 font-mono">
      {!start ? (
        <div className="flex items-center flex-col gap-3 w-[500px]">
          <button
            onClick={handleStart}
            className="hover:opacity-75 text-white font-bold py-2 w-[300px] px-4 rounded bg-slate-500"
          >
            Start
          </button>
          <div>
            {/* <div className="flex gap-3">
              <label>Minimum Chunk Size</label>
              <input
                type="range"
                min={1}
                max={60}
                value={minimumChunkSizeState}
                onChange={handleMinimumChunkSizeChange}
              />
              <span>{minimumChunkSizeState}</span>
            </div>
            <p>Playback Delay: {(playbackDelay / 1000).toFixed(4)} seconds</p> */}
            <div className="text-[11px] text-slate-500">
              <p>
                Higher chunk size -&gt; Better decode quality | Slower playback
              </p>
              <p>
                Lower chunk size -&gt; Faster playback | Lower decode quality
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <SimliFaceStream ref={simliFaceStreamRef} start={start}/>
          <br />
          <button
            className={
              "hover:opacity-75 text-white font-bold py-2 w-[300px] px-4 rounded" +
              (start ? " bg-red-500" : " bg-green-500")
            }
            onClick={() => {
              start ? handleStop() : handleStart();
            }}
          >
            {start ? "Stop" : "Start"}
          </button>
          <br />
          {/* <div>
            <p>
              Time till first byte: {(timeTillFirstByteState / 1000).toFixed(4)}{" "}
              seconds
            </p>
            <p>Total chunk collection time: {(chunkCollectionTime/1000).toFixed(4)} seconds</p>
            <p>AudioQueue Length: {audioQueueLengthState}</p>
            <p>FrameQueue Length: {frameQueueLengthState}</p>
            <p>Minimum Chunk Size: {minimumChunkSizeState}</p>
            <p>Playback Delay: {(playbackDelay / 1000).toFixed(4)} seconds</p>
          </div>

          <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex"></div> */}
        </>
      )}
      <Link
        href={"https://www.simli.com/"}
        className="absolute bottom-4 hover:opacity-100 flex items-start text-l gap-2 opacity-30 cursor-pointer"
      >
        Powered by{" "}
        <img src="/simli_logo.svg" alt="Simli Logo" width={64} height={64} />
      </Link>
    </main>
  );
}
