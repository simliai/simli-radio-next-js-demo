import aiohttp
from fastapi import FastAPI , WebSocket, WebSocketDisconnect
import granian
from granian import Granian
from granian.constants import Interfaces

app = FastAPI()

async def stream_audio(websocket: WebSocket, url: str):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status != 200:
                return
            while True:
                data = await resp.content.read(16000)  #TODO: Changing the chunk size below 30000 bytes causes the audio to be choppy
                if not data:
                    break
                await websocket.send_bytes(data)

@app.websocket("/audio")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        await stream_audio(websocket, "https://radio.talksport.com/stream?gdpr=0&partnerId=RadioTime")
    except WebSocketDisconnect:
        pass

@app.websocket("/echo")
async def echo(websocket: WebSocket):
    await websocket.accept()
    while True:
        try:
            data = await websocket.receive_bytes()
            await websocket.send_bytes(data)
        except WebSocketDisconnect:
            break

if __name__ == "__main__":
    Granian("app:app",interface=Interfaces.ASGI,port=9000).serve()