# CrisisOS

CrisisOS is a mobile and web emergency response coordination demo. Citizens can report incidents, responders can follow assignments, and operators can review AI-assisted triage before approving dispatch. AI recommendations do not dispatch responders automatically.

The project has an Expo/React Native frontend, a FastAPI backend, and MongoDB persistence. The backend also supports optional AI triage and object storage integrations.

## Requirements

- Git
- Node.js and npm (use a current Node.js LTS release)
- Python 3.11 or newer
- A MongoDB database, local or hosted
- Expo Go for running the app on a phone (or an emulator/development build)

## Get the code

```bash
git clone <your-repository-url>
cd CricisOS
```

## Configure the backend

Create `backend/.env` from the example:

```bash
cp backend/.env.example backend/.env
```

On Windows PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

Edit `backend/.env` and set `MONGO_URL`, `DB_NAME`, and a unique `JWT_SECRET`. `EMERGENT_LLM_KEY` is optional; without it, AI triage uses the backend's deterministic fallback. Demo passwords are optional; set them if you want the seeded demo accounts. Keep `.env` private and never commit real credentials.

Install and start the backend from the repository root:

### Windows PowerShell

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000
```

If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned` in that terminal, then activate the environment again. This changes policy only for that PowerShell process.

### macOS / Linux

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000
```

The API health endpoint is `http://127.0.0.1:8000/health`; interactive API docs are at `http://127.0.0.1:8000/docs`.

## Configure and start the frontend

In a second terminal, create `frontend/.env` from its example and set the API URL:

```bash
cp frontend/.env.example frontend/.env
```

On Windows PowerShell:

```powershell
Copy-Item frontend/.env.example frontend/.env
```

Install dependencies and start Expo:

```bash
cd frontend
npm ci
npx expo start
```

Press `w` to open the web app, or scan the QR code with Expo Go. If changing `.env`, restart Expo with `npx expo start -c` so the new API URL is bundled.

## Using Expo Go on another device

`127.0.0.1` refers to the device making the request. It works for a browser on the same computer, but a phone needs the computer's LAN IP address.

1. Put the phone and development computer on the same Wi-Fi network.
2. Set `EXPO_PUBLIC_BACKEND_URL` in `frontend/.env` to `http://<computer-lan-ip>:8000` (for example, `http://192.168.1.25:8000`).
3. Start the backend with `python -m uvicorn server:app --reload --host 0.0.0.0 --port 8000`.
4. Allow Python/port 8000 through the computer's firewall on the private network if prompted.
5. Restart Expo with `npx expo start -c`, then scan the new QR code.

The LAN IP is specific to each computer/network. Do not commit it as a shared default. Expo's tunnel only serves the frontend; the phone still needs network access to the backend.

## Optional backend tests

The backend tests call a running API and need a configured test database plus demo user passwords. Start the backend first, set `EXPO_PUBLIC_BACKEND_URL` and the `DEMO_*_PASSWORD` values in the environment, then run from `backend`:

```bash
python -m pip install -r requirements.txt
python -m pytest
```

The test suite resets demo data. Use a development/test database, never production data.

## Environment variables

See [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example) for the supported local configuration. Never put secrets in `EXPO_PUBLIC_*` variables: Expo embeds those values in the client bundle.

If a credential has ever been committed or shared publicly, rotate it before publishing the repository.
