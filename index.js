const { createServer } = require("http");
const express = require("express");
const { WebSocket } = require("ws");

const app = express();
const server = createServer(app);

app.use(express.static('public'));

const wss = new WebSocket.Server({
    noServer: true
});


function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

wss.on("connection", (ws, req) => {

    let interval = null;

    ws.once("close", () => {
        console.log("WebSocket connection closed")
        clearInterval(interval);
    });

    ws.on("message", (msg) => {

        msg = JSON.parse(msg.toString());
        console.log("message from client", msg);

    });

    interval = setInterval(() => {

        let data = JSON.stringify({
            timestamp: Date.now(),
            value: getRandomInt(0, 100)
        });

        ws.send(data);

    }, 1000);

});




app.get("/events", (req, res) => {
    if (req.headers["upgrade"] && req.headers["connection"]) {

        // handle websocket
        wss.handleUpgrade(req, req.socket, req.headers, (ws) => {
            console.log("New Websocket connection");
            wss.emit("connection", ws, req);
        });

    } else {

        // no websocket handshake
        // tell them they are stupid!
        res.status(400).end();

    }
});



server.listen(8123, "127.0.0.1", () => {

    let { address, port } = server.address();
    console.log(`HTTP Server listening on  http://${address}:${port}`);

});