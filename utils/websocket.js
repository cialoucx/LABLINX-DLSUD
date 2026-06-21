const ws = require("ws");

let wss = null;

const setWss = (server) => {
  wss = new ws.Server({ server });
  wss.on("connection", (socket) => {
    console.log("🔌 New WebSocket connection");
    socket.on("close", () => {
      console.log("❌ WebSocket connection closed");
    });
  });
  return wss;
};

const broadcastRefresh = () => {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.readyState === ws.OPEN) {
      client.send(JSON.stringify({ type: "refresh" }));
    }
  });
};

module.exports = { setWss, broadcastRefresh };
