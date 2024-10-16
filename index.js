const { createServer } = require("http");
const express = require("express");
const { WebSocket } = require("ws");
const { createInterface } = require("readline");
const { SerialPort } = require("serialport");

const app = express();
const server = createServer(app);
var port = null;

app.use(express.static('public'));

const wss = new WebSocket.Server({
    noServer: true
});


function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}


function openSerialPort(opts) {
    port = new SerialPort({
        path: "/dev/ttyUSB0",
        baudRate: 9600,
        parity: "none",
        stopBits: 1,
        dataBits: 8,
        lock: false,
        ...opts
    });
}


function closeSerialPort() {
    if (port && port.isOpen) {
        port?.close();
    }
}


function crc16Modbus(buffer) {
    let crc = 0xFFFF;

    for (let pos = 0; pos < buffer.length; pos++) {
        crc ^= buffer[pos]; // XOR byte into least significant byte of crc

        for (let i = 8; i !== 0; i--) { // Loop over each bit
            if ((crc & 0x0001) !== 0) { // If the LSB is set
                crc >>= 1;              // Shift right
                crc ^= 0xA001;          // Apply XOR with polynomial
            } else {
                crc >>= 1;              // Just shift right
            }
        }
    }

    // CRC is usually appended in little-endian, so swap the bytes
    return Buffer.from([crc & 0xFF, (crc >> 8) & 0xFF]);
}


function createModbusMessage(id, register) {

    let buff = Buffer.from([
        id,         // device id
        0x04,       // function code (Read Input Register)
        0x00,       // register address placeholder byte 1
        0x00,       // register address placeholder byte  2
        0x00,       // num of coils byte 1
        0x02        // num of coils byte 2
    ]);

    buff.writeUInt8(id, 0); // replace device id
    buff.writeUInt16BE(register, 2); // replace register

    console.log("Modbus message", buff)

    return buff;

}


function parseModbusMessage(request, data) {

    let resp = data.slice(0, data.length - 2);
    let crc = data.slice(data.length - 2);

    if (Buffer.compare(crc, crc16Modbus(resp)) !== 0) {
        throw new Error("Invalid checksum");
    }

    if (request[0] !== data[0]) {
        throw new Error("Invalid device Id");
    }

    return data.readFloat16BE(4);

}


function handleModbus(id, register) {
    return new Promise((resolve, reject) => {

        // create modbus RTU message
        let request = createModbusMessage(id, register);

        // append & create checksum
        let payload = Buffer.concat([
            request,
            crc16Modbus(request)
        ]);

        // write data to serial port
        // wait till its flushed
        port.write(payload, (err) => {
            if (err) {

                reject(err);

            } else {

                // flushed payload data
                // listen for response data
                port.once("data", (data) => {
                    try {

                        // parse response
                        // compare with request
                        let value = parseModbusMessage(request, data);

                        resolve(value);

                    } catch (err) {
                        reject(err);
                    }
                });

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

        // create modbus message(s)
        Promise.all([
            handleModbus(address, 22),  // pressure 1    "Absolutdruck bei 20"
            handleModbus(address, 0),   // pressure 2    "Absolutdruck"
            handleModbus(address, 12)   // temperature
        ]).then(([
            pressure1, 
            pressure2, 
            temperature
        ]) => {

            cb({
                pressure1,
                pressure2,
                temperature
            });

        }).catch((err) => {

            console.error(err);

        });

    }
}


wss.on("connection", (ws, req) => {
    if (process.argv[2] === "--demo") {

        const rl = createInterface({
            input: process.stdin,
            output: process.stdout
        });

        function askQuestion() {
            rl.question("<druck 1>, <durck 2>, <temp>:", (answer) => {

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

                    let interval = setInterval(() => {

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

                    }, 3000);

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