import express from 'express';
import http from 'http';
import https from 'https';
import { WebSocketServer } from 'ws';
import * as nodePty from 'node-pty';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTTP_PORT = 80;
const HTTPS_PORT = 443;

const STATIC_DIR = "dist/client";
const HOME_DIR = "";
const ENV_VARIABLES = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "en_US.UTF-8",
};

const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, '../ssl/private.key')),
    cert: fs.readFileSync(path.join(__dirname, '../ssl/vteacher_biz.crt')),
    ca: fs.readFileSync(path.join(__dirname, '../ssl/vteacher_biz.ca-bundle')),
};

const app = express();
const httpServer = http.createServer(app);
const httpsServer = https.createServer(sslOptions, app);

const allowedOrigins = ['http://localhost:3000', 'https://school.vteacher.biz'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
}));

app.use(express.json());
app.use("/", express.static(STATIC_DIR));

const wsHttp = new WebSocketServer({ server: httpServer });
const wsHttps = new WebSocketServer({ server: httpsServer });

const setupWebSocket = (wss: WebSocketServer) => {
    wss.on("connection", (ws) => {
        console.log("New WebSocket connection established");

        const pty = nodePty.spawn("bash", ["--login"], {
            name: "xterm-color",
            cols: 80,
            rows: 24,
            cwd: HOME_DIR,
            env: ENV_VARIABLES,
        });

        pty.onData((data) => {
            const isError = /(not found|error|No such file or directory|Unknown|cannot|failed)/i.test(data);
            const messageType = isError ? "error" : "output";
            ws.send(JSON.stringify({ type: messageType, output: data }));
        });

        ws.on("message", (message) => {
            const m = JSON.parse(message.toString());
            if (m.input) {
                pty.write(m.input);
            } else if (m.resize) {
                pty.resize(m.resize[0], m.resize[1]);
            }
        });

        ws.on("close", () => {
            console.log("WebSocket connection closed");
            pty.kill();
        });

        pty.on("exit", (code, signal) => {
            console.log(`PTY process exited with code ${code}, signal ${signal}`);
        });
    });
};

setupWebSocket(wsHttp);
setupWebSocket(wsHttps);

httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP server started on port ${HTTP_PORT}`);
});

httpsServer.listen(HTTPS_PORT, () => {
    console.log(`HTTPS server started on port ${HTTPS_PORT}`);
});
