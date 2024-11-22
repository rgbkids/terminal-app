import express from 'express';
import https from 'https';
import { WebSocketServer } from 'ws';
import * as nodePty from 'node-pty';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 443;
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
const server = https.createServer(sslOptions, app);

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

    pty.onData((data) => {
        console.debug("PTY output:", data);
        const isError = /(not found|error|No such file or directory|Unknown|cannot|failed)/i.test(data);
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

app.post("/file", (req, res) => {
    const { filepath, content } = req.body;

    if (!filepath || !content) {
        return res.status(400).json({ error: "Filepath and content are required." });
    }

    const fullPath = path.join(HOME_DIR, filepath);

    fs.writeFile(fullPath, content, (err) => {
        if (err) {
            console.error("Error writing file:", err);
            return res.status(500).json({ error: "Failed to write file." });
        }
        console.log(`File written at ${fullPath}`);
        res.json({ message: "File written successfully." });
    });
});

app.get("/file", (req, res) => {
    const filepath = req.query.filepath;

    if (typeof filepath !== "string") {
        return res.status(400).json({ error: "Filepath must be a single string value." });
    }

    const fullPath = path.join(HOME_DIR, filepath);

    fs.readFile(fullPath, "utf8", (err, data) => {
        if (err) {
            console.error("Error reading file:", err);
            return res.status(500).json({ error: "Failed to read file." });
        }
        console.log(`File read from ${fullPath}`);
        res.json({ content: data });
    });
});

type DirectoryItem = {
    name: string;
    type: "file" | "directory";
    contents?: DirectoryItem[];
};

app.get("/directory", (req, res) => {
    const dirPath = req.query.dirPath;

    if (typeof dirPath !== "string") {
        return res.status(400).json({ error: "Directory path must be a single string value." });
    }

    const fullPath = path.join(HOME_DIR, dirPath);

    const getDirectoryContents = (currentPath: string, level: number): DirectoryItem[] => {
        if (level > 5) {
            return [];
        }

        try {
            const items = fs.readdirSync(currentPath, { withFileTypes: true });
            return items.map((item) => {
                const itemPath = path.join(currentPath, item.name);
                if (item.isDirectory()) {
                    return {
                        name: item.name,
                        type: "directory",
                        contents: getDirectoryContents(itemPath, level + 1),
                    };
                } else {
                    return {
                        name: item.name,
                        type: "file",
                    };
                }
            });
        } catch (err) {
            console.error("Error reading directory:", err);
            return [{ name: "Error", type: "file" }];
        }
    };

    const directoryContents = getDirectoryContents(fullPath, 1);

    if (!directoryContents) {
        return res.status(500).json({ error: "Failed to read directory or depth exceeded." });
    }

    res.json({ contents: directoryContents });
});

server.listen(PORT, () => {
    console.log(`Secure server started on port ${PORT}`);
});
