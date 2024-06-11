import React, { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import SimliFaceStream from "@/SimliFaceStream/SimliFaceStream";
import { StartAudioToVideoSession } from "./api/startAudioToVideoSession";

export default function Home() {
  const [start, setStart] = useState(false);
  const [playing, setPlaying] = useState(false);

  const simliFaceStreamRef = useRef(null);
  const [sessionToken, setSessionToken] = useState("");
  const [minimumChunkSizeState, setMinimumChunkSizeState] = useState(10);
  const [faceId, setFaceId] = useState("04d062bc-00ce-4bb0-ace9-76880e3987ec");

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:9000/audio");
    ws.onopen = () => {
      console.log("Connected to audio websocket");
    };

    ws.onmessage = (event) => {
      // console.log("Received audio data", event.data);
      if (simliFaceStreamRef.current) {
        simliFaceStreamRef.current.sendAudioDataToLipsync(event.data);
      }
    };

    return () => {
      ws.close();
    };
  }, [start]);

  const handleStart = async () => {
    StartAudioToVideoSession(faceId, true, true).then((response) => {
      console.log("Session Token:", response);
      setSessionToken(response.session_token);
      setStart(true);
    });
  }

  const handlePause = () => {
    setPlaying(false);
  };

  const handleResume = () => {
    setPlaying(true);
  };

  const handleMinimumChunkSizeChange = (event: any) => {
    setPlaying(false);
    setMinimumChunkSizeState(parseInt(event.target.value));
  };

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
            <div className="flex gap-3">
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
            <p>Playback Delay: {33 * minimumChunkSizeState} ms</p>
            <div className="text-[11px] text-slate-500">
              <p>Higher chunk size -&gt; Better decode quality | Slower playback</p>
              <p>Lower chunk size -&gt; Faster playback | Lower decode quality</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <SimliFaceStream ref={simliFaceStreamRef} start={playing} sessionToken={sessionToken} minimumChunkSize={minimumChunkSizeState} />
          <br />
          <button
            className={
              "hover:opacity-75 text-white font-bold py-2 w-[300px] px-4 rounded" +
              (playing ? " bg-red-500" : " bg-green-500")
            }
            onClick={() => {
              playing ? handlePause() : handleResume();
            }}
          >
            {playing ? "Stop" : "Play"}
          </button>
          <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex"></div>
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
