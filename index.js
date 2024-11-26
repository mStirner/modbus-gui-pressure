
const { createServer, ServerResponse } = require("http");
const express = require("express");
const { WebSocket } = require("ws");
const { createInterface } = require("readline");
const { SerialPort } = require("serialport");
const timers = require("timers/promises");
const {
    getRandomInt,
    toFixedTruncate,
    crc16Modbus,
    createModbusMessage,
    parseModbusMessage
} = require("./functions.js");

const app = express();
const server = createServer(app);
var port = null;

// handle websocket upgrade properly
// otherwise the req.socket get closed
// and the ws connection is dropped
server.on("upgrade", (req, socket) => {

    let res = new ServerResponse(req);
    res.assignSocket(socket);

    res.on("finish", () => {
        res.socket.destroy();
    });

    app(req, res);

});


// server static files from folder public
app.use(express.static('public'));


// init websocket server
const wss = new WebSocket.Server({
    noServer: true
});


// handle serial port open
function openSerialPort(opts) {
    port = new SerialPort({
        path: "/dev/ttyUSB0",   //initialise USB adapter
        baudRate: 9600,         // Baudrate Voreinstellung
        parity: "none",
        stopBits: 1,
        dataBits: 8,
        lock: false,
        ...opts
    });
}


// handle serial port close
function closeSerialPort() {
    if (port && port.isOpen) {
        port?.close();
    }
}


// handle modbus query, wrapper function
function handleModbus(id, register) {
    return new Promise((resolve, reject) => {

        // create modbus RTU message
        let request = createModbusMessage(id, register);

        // append & create checksum
        let payload = Buffer.concat([
            request,
            crc16Modbus(request)
        ]);

        console.log();

        // write data to serial port
        // wait till its flushed
        port.write(payload, (err) => {
            console.log("written modebus message", payload);
            if (err) {

                reject(err);

            } else {

                let timeout = null;

                // wraper for incoming messages
                let messageHandler = (data) => {
                    console.log("resp", data);
                    try {

                        // parse response
                        // compare with request
                        let value = parseModbusMessage(request, data);

                        process.nextTick(() => {
                            // pass raw value to underlaying functoin
                            // convert decimals of temp & pressure  sperate
                            //resolve(toFixedTruncate(value, 2));
                            resolve(value);
                        });

                    } catch (err) {

                        // pass error
                        reject(err);

                    } finally {

                        // clear timeout
                        clearTimeout(timeout);

                    }
                };

                // remove message handler after 1.5s
                // when the device does not respond
                timeout = setTimeout(() => {
                    console.log("No message received for request, remove handler, prevents memeory leak", payload)
                    port.off("data", messageHandler);
                }, 1500);

                // flushed payload data
                // listen for response data
                port.once("data", messageHandler);

            }
        });

    });
}


function queryMeter(address, cb) {
    if (process.argv[2] === "--simulate") {

        // simulate values
        cb({
            pressure1: getRandomInt(0, 100),
            pressure2: getRandomInt(0, 100),
            temperature: getRandomInt(23, 30)
        });

    } else {

        (async () => {
            try {

                let pressure1 = await handleModbus(address, 23);  //23 = Druck, normiert bei 20′C , 61 = MPa
                await timers.setTimeout(10);
                let pressure2 = await handleModbus(address, 3);
                await timers.setTimeout(10);
                let temperature = await handleModbus(address, 13);

                cb({
                    pressure1: toFixedTruncate(pressure1, 4),
                    pressure2: toFixedTruncate(pressure2, 4),
                    temperature: toFixedTruncate(temperature, 2)
                });

            } catch (err) {
                console.error(err);
            }
        })();

    }
}


wss.on("connection", (ws, req) => {

    let interval = null;

    ws.once("close", () => {
        console.log("ws connection closed");
        closeSerialPort();
        clearInterval(interval);
    });

    if (process.argv[2] === "--demo") {

        const rl = createInterface({
            input: process.stdin,
            output: process.stdout
        });

        function askQuestion() {
            rl.question("<druck 1>, <druck 2>, <temp>:", (answer) => {

                if (answer.toLowerCase() === "exit") {
                    rl.close();
                    process.exit();
                }

                let [pressure1, pressure2, temperature] = answer.split(",").map((v = null) => {
                    return Number(v);
                });

                if (!pressure1 || !pressure2 || !temperature) {
                    console.log("Du musst drei werte mit ',' getrennt angeben! Z.b: 9.52,2.47,23.07");
                    console.log("");
                }

                ws.send(JSON.stringify({
                    timestamp: Date.now(),
                    pressure1,
                    pressure2,
                    temperature
                }));

                askQuestion();

            });
        }

        askQuestion();

    } else if (process.argv[2] === "--simulate") {

        interval = setInterval(() => {

            console.clear();
            console.log(`[${Date.now()}] Query Modbus Device...`);

            queryMeter(null, ({ pressure1, pressure2, temperature }) => {

                let data = JSON.stringify({
                    timestamp: Date.now(),
                    pressure1,
                    pressure2,
                    temperature
                });

                ws.send(data);

            });

        }, 3000);       //Intervall der Abfrage

    } else {

        ws.on("message", (msg) => {
            try {

                // deconstruct settings from client
                let { baudRate, address, stopBits, parity } = JSON.parse(msg.toString());

                if (baudRate === "---" || address === "---") {

                    closeSerialPort();

                    console.log("You need to set baudRate & address!", {
                        baudRate,
                        address
                    });

                } else {

                    // close previous open port
                    closeSerialPort();

                    // open port with settings
                    openSerialPort({
                        baudRate,
                        stopBits,
                        parity
                    });

                    interval = setInterval(() => {


                        console.clear();
                        console.log(`[${Date.now()}] Query Modbus Device...`);

                        queryMeter(address, ({ pressure1, pressure2, temperature }) => {

                            let data = JSON.stringify({
                                timestamp: Date.now(),
                                pressure1,
                                pressure2,
                                temperature
                            });

                            ws.send(data);

                        });

                    }, 3000);       //Intervall der Abfrage

                    port.once("close", () => {
                        console.log("Serialport closed")
                        clearInterval(interval);
                    });

                    port.once("open", () => {
                        console.log("Serialport open! Settings: ", port.settings);
                    });

                    port.once("error", (err) => {
                        console.error(err);
                        process.exit(1000);
                    });

                }

            } catch (err) {

                console.error(err);
                process.exit(1);

            }
        });

    }

});


wss.on('close', function close() {
    closeSerialPort();
    clearInterval(interval);
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
        res.status(400).end();

    }
});


server.listen(8123, "0.0.0.0", () => {

    let { address, port } = server.address();
    console.log(`HTTP Server listening on  http://${address}:${port}`);

});