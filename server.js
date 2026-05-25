import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "dist");

const app = express();
app.use(cors({ origin: "*" }));
app.get("/health", (_req, res) => {
  res.json({ ok: true, online: io.engine.clientsCount });
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const queues = {
  text: [],
  video: []
};

const rooms = new Map();

function makeUserId() {
  return `Pezzotto_User_${Math.floor(1000 + Math.random() * 9000)}`;
}

function normalizeInterests(interests = []) {
  return [...new Set(
    interests
      .map((tag) => String(tag).trim().toLowerCase())
      .filter(Boolean)
  )];
}

function hasSharedInterest(a = [], b = []) {
  if (!a.length || !b.length) return false;
  const bSet = new Set(b);
  return a.some((tag) => bSet.has(tag));
}

function removeFromQueues(socketId) {
  for (const mode of Object.keys(queues)) {
    queues[mode] = queues[mode].filter((entry) => entry.socketId !== socketId);
  }
}

function getLiveQueue(mode) {
  queues[mode] = queues[mode].filter((entry) => io.sockets.sockets.has(entry.socketId));
  return queues[mode];
}

function pickMatch(mode, interests) {
  const queue = getLiveQueue(mode);
  const preferredIndex = queue.findIndex((entry) => hasSharedInterest(interests, entry.interests));
  const index = preferredIndex >= 0 ? preferredIndex : 0;
  return queue.splice(index, 1)[0];
}

function publicUser(socket) {
  return {
    id: socket.id,
    userId: socket.data.userId,
    interests: socket.data.interests || []
  };
}

function emitOnlineCount() {
  io.emit("online-count", io.engine.clientsCount);
}

function leaveCurrentRoom(socket, notifyPeer = true) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.peerId = null;

  if (!room) return;

  const peerId = room.members.find((id) => id !== socket.id);
  rooms.delete(roomId);

  if (notifyPeer && peerId) {
    const peerSocket = io.sockets.sockets.get(peerId);
    if (peerSocket) {
      peerSocket.leave(roomId);
      peerSocket.data.roomId = null;
      peerSocket.data.peerId = null;
      peerSocket.emit("stranger-disconnected");
    }
  }
}

function enqueueOrMatch(socket, payload) {
  const mode = payload.mode === "video" ? "video" : "text";
  const interests = normalizeInterests(payload.interests);

  removeFromQueues(socket.id);
  leaveCurrentRoom(socket);

  socket.data.mode = mode;
  socket.data.interests = interests;
  socket.emit("searching", { mode });

  const match = pickMatch(mode, interests);
  if (!match || match.socketId === socket.id) {
    queues[mode].push({
      socketId: socket.id,
      userId: socket.data.userId,
      interests,
      queuedAt: Date.now()
    });
    return;
  }

  const peer = io.sockets.sockets.get(match.socketId);
  if (!peer) {
    queues[mode].push({
      socketId: socket.id,
      userId: socket.data.userId,
      interests,
      queuedAt: Date.now()
    });
    return;
  }

  const roomId = `room_${randomUUID()}`;
  rooms.set(roomId, { mode, members: [peer.id, socket.id], createdAt: Date.now() });

  peer.join(roomId);
  socket.join(roomId);
  peer.data.roomId = roomId;
  socket.data.roomId = roomId;
  peer.data.peerId = socket.id;
  socket.data.peerId = peer.id;

  peer.emit("matched", {
    roomId,
    mode,
    peer: publicUser(socket),
    isInitiator: false
  });

  socket.emit("matched", {
    roomId,
    mode,
    peer: publicUser(peer),
    isInitiator: true
  });
}

io.on("connection", (socket) => {
  socket.data.userId = makeUserId();
  socket.emit("identity", { userId: socket.data.userId });
  emitOnlineCount();

  socket.on("start", (payload = {}) => {
    enqueueOrMatch(socket, payload);
  });

  socket.on("cancel-search", () => {
    removeFromQueues(socket.id);
    socket.emit("idle");
  });

  socket.on("message", (message = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    socket.to(roomId).emit("message", {
      id: randomUUID(),
      from: socket.data.userId,
      text: String(message.text || "").slice(0, 2000),
      sentAt: new Date().toISOString()
    });
  });

  socket.on("typing", (isTyping) => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit("typing", Boolean(isTyping));
  });

  socket.on("webrtc-signal", (signal) => {
    const peerId = socket.data.peerId;
    if (peerId) io.to(peerId).emit("webrtc-signal", signal);
  });

  socket.on("stop", () => {
    removeFromQueues(socket.id);
    leaveCurrentRoom(socket);
    socket.emit("idle");
  });

  socket.on("disconnect", () => {
    removeFromQueues(socket.id);
    leaveCurrentRoom(socket);
    emitOnlineCount();
  });
});

httpServer.listen(PORT, () => {
  console.log(`Pezzotto server listening on http://localhost:${PORT}`);
});
