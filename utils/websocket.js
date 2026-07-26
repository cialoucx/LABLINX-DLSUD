const ws = require("ws");
let wss = null;
const setWss = (server) => {
  wss = new ws.Server({ server: server });
  wss.on("connection", (socket) => {
    console.log("[WS] New connection established");
    socket.on("close", () => {
      console.log("[WS] Connection closed");
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
module.exports = { setWss: setWss, broadcastRefresh: broadcastRefresh };
