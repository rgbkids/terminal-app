import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import * as nodePty from 'node-pty';

const PORT = 8080;
const STATIC_DIR = "dist/client";
const HOME_DIR = "/home/user";
const ENV_VARIABLES = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "en_US.UTF-8",
};

const app = express();
const server = http.createServer(app);

app.use("/", express.static(STATIC_DIR));

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
    console.log("New WebSocket connection established");

    const pty = nodePty.spawn("bash", ["--login"], {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: HOME_DIR,
        env: ENV_VARIABLES,
    });

    console.log("PTY process started with PID:", pty.pid);

    pty.onData((data: string) => {
        console.debug("PTY output:", data);

        const isError = /(not found|error|No such file or directory|Unknown|cannot)/i.test(data);
        const messageType = isError ? "error" : "output";

        ws.send(JSON.stringify({ type: messageType, output: data }));
    });

    ws.on("message", (message) => {
        const m = JSON.parse(message.toString());
        if (m.input) {
            console.debug("Received input from WebSocket:", m.input);
            pty.write(m.input);
        } else if (m.resize) {
            console.debug("Resizing PTY to", m.resize);
            pty.resize(m.resize[0], m.resize[1]);
        }
    });

    ws.on("close", () => {
        console.log("WebSocket connection closed");
        pty.kill();
        console.log("PTY process terminated");
    });

    pty.on("exit", (code, signal) => {
        console.log(`PTY process exited with code ${code}, signal ${signal}`);
    });
});

server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
