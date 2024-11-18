const {SerialPort} = require("serialport");

const port = new SerialPort({
        path: "/dev/ttyUSB0",   //initialise USB adapter
        baudRate: 9600,         // Baudrate Voreinstellung
        parity: "even",
        stopBits: 1,
        dataBits: 8,
        lock: false,
});





port.once("open", () => {
        console.log("port open");
});



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





const data = Buffer.from([
  0x02,         // addr
  0x04,         // fnc code
  0x00,
  13,           // register, 13 = temp in C, 1 = durck in bar, 23 = Druck normiert auf 20 °C
  0x00,
  0x02          // num coils, 2 coils = 4 bytes
]);


port.on("data", (data) => {
        console.log("data", data);

        // skip first 3 bytes
        // 1 = slave id
        // 2 = fnc code
        // 3 = number of bytes
        //
    let resp = data.slice(0, data.length - 2);
    let crc = data.slice(data.length - 2);
    let payload = resp.slice(3, data.length - 2);

    if (Buffer.compare(crc, crc16Modbus(resp)) !== 0) {
        throw new Error("Invalid checksum");
    }

    console.log("resp", resp);
    console.log("crc", crc);
    console.log("data", payload);


    console.log("value:", payload.readFloatBE());

    port.close();

});




const payload = Buffer.concat([
        data,
        crc16Modbus(data)
]);

port.write(payload, () => {
        console.log("wirten", payload);
});
