import { Buffer } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";

const chunk = (type: string, data: Buffer): Buffer => {
    const typeBuffer = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));

    return Buffer.concat([length, typeBuffer, data, crc]);
};

type CreatePngOptions = {
    animated?: boolean;
};

export const createPng = (
    width: number,
    height: number,
    options: CreatePngOptions = {},
): Buffer => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(2, 9);

    const scanlines = Buffer.alloc(height * (1 + width * 3));

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        ...(options.animated ? [chunk("acTL", Buffer.alloc(8))] : []),
        chunk("IDAT", deflateSync(scanlines)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
};
