# simli-next-js-demo

In this demo we are using webhooks to stream incoming audio from a [radio broadcast](https://radio.talksport.com/stream) to `ws://api.simli.ai/LipsyncStream` which returns lipsynced video and audio frames to be displayed on frontend

Websocket schema: [Click here](https://github.com/simliai/simli-next-js-demo/blob/main/Websockets.md)

```mermaid
sequenceDiagram
    participant Client
    participant Frontend
    participant AudioServer
    participant LipsyncServer

    Client->>Frontend: Open webpage
    activate Frontend
    Frontend->>Frontend: Render UI
    Frontend->>Frontend: User clicks on Start button
    Frontend->>Frontend: AudioContext and VideoContext initialized
    Frontend->>Frontend: WebSocket connection created for audio
    Frontend->>Frontend: WebSocket connection created for lipsync
    Frontend->>AudioServer: Connects to audio server
    activate AudioServer
    AudioServer->>AudioServer: WebSocket connection opened
    AudioServer->>Frontend: Connection established
    deactivate AudioServer
    Frontend->>LipsyncServer: Connects to lipsync server
    activate LipsyncServer
    LipsyncServer->>LipsyncServer: WebSocket connection opened
    LipsyncServer->>Frontend: Connection established
    deactivate LipsyncServer
    Frontend->>LipsyncServer: Sends metadata
    Frontend->>Frontend: Start main loop for audio and video playback
    Frontend->>AudioServer: Receive audio broadcast data
    AudioServer->>Frontend: Audio data
    Frontend->>LipsyncServer: Send Audio data to lipsync
    LipsyncServer->>Frontend: Lipsync data
    Frontend->>Frontend: Process lipsync data to frames and audio
    Frontend->>Frontend: Update audio queue
    Frontend->>Frontend: Update video queue
    Frontend->>Frontend: Play audio frames queue
    Frontend->>Frontend: Play video frames queue
    deactivate Frontend
```

## Usage

### Terminal 1: (AudioServer)

1. Install python modules

Linux
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows
```bash
pip install -r requirements.txt
```

2. run radio broadcast websocket server
```bash
python app.py
```

### Terminal 2: (Frontend)
Open another terminal
1. Install packages
```bash
npm install
```

2. Start
```bash
npm run dev
```
