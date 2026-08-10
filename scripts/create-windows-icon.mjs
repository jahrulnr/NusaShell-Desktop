import { readFile, writeFile } from "node:fs/promises";

const pngPath = new URL("../apps/desktop/assets/nusashell.png", import.meta.url);
const icoPath = new URL("../apps/desktop/assets/nusashell.ico", import.meta.url);
const png = await readFile(pngPath);
if (png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) {
  throw new Error("Expected a PNG source icon");
}
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(width >= 256 ? 0 : width, 6);
header.writeUInt8(height >= 256 ? 0 : height, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);
await writeFile(icoPath, Buffer.concat([header, png]));
