# simli-next-js-demo

Stream a radio broadcast from a local server using websockets, then read and process the audio on frontend

## Usage

### Terminal 1:

1. Intall python modules
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. run radio broadcast websocket server
```bash
python app.py
```

### Terminal 2:
Open another terminal
1. Install packages
```bash
npm install
```

2. Start
```bash
npm run dev
```
