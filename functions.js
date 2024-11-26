function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}


function toFixedTruncate(number, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.floor(number * factor) / factor;
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

    //console.log("Modbus message", buff);

    return buff;

}


function parseModbusMessage(request, data) {

    let resp = data.slice(0, data.length - 2);
    let crc = data.slice(data.length - 2);
    let payload = resp.slice(3, data.length - 2);

    if (request[0] !== data[0]) {
        throw new Error("Invalid device Id");
    }    

    if (request[1] !== data[1]) {
        throw new Error("Invalid function code");
    }

    if((data[1] & 0x80) === 0x80){
        throw new Error(`Modbus error from slave ${slaveId}: Exception Code ${data[2]}`);
    }

    if (Buffer.compare(crc, crc16Modbus(resp)) !== 0) {
        throw new Error("Invalid checksum");
    }

    return payload.readFloatBE();

}


module.exports = {
    getRandomInt,
    toFixedTruncate,
    crc16Modbus,
    createModbusMessage,
    parseModbusMessage
};