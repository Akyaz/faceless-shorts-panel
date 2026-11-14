// Zip açıcı: GitHub'ın deneme videosu paketini (short.mp4 + metadata.json) tarayıcıda açar. Kütüphane yok;
// sıkıştırma çözümü tarayıcının DecompressionStream'i ("deflate-raw"). Node 18+ ile de çalışır.
// Yalnızca bu paketlerin kullandığı biçim: sıkıştırmasız (0) ya da deflate (8), zip64 yok.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Dosya adı -> içerik (Uint8Array). Yerel başlıktaki boyutlar boş olabildiği için merkez dizin okunur.
export async function unzip(buffer) {
  const view = new DataView(buffer);
  let end = buffer.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== EOCD) end--;
  if (end < 0) throw new Error("Zip dosyası okunamadı.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error("Zip dizini bozuk.");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (view.getUint32(offset, true) !== LOCAL) throw new Error("Zip kaydı bozuk.");
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = new Uint8Array(buffer, start, size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflate(data));
    else throw new Error(`Desteklenmeyen sıkıştırma: ${method}`);
  }
  return files;
}
