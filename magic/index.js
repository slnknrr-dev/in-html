// magic/index.js - file type detection by content (magic numbers), never by the name alone: a table of signatures
// (archives, images, audio, video, documents, fonts, executables, databases, disk images…), refinement of container
// formats by what they hold (ZIP -> DOCX / XLSX / PPTX / ODF / EPUB / JAR / APK…, RIFF -> WAV / AVI / WebP,
// ISO BMFF brands -> MP4 / M4A / MOV / HEIC / AVIF / 3GP, Ogg -> Opus / Vorbis / FLAC / Theora, EBML -> WebM / MKV,
// compound files -> DOC / XLS / PPT / MSI), and a text sniffer (BOMs, UTF-8, HTML, XML, SVG, JSON, scripts).
// The name only breaks ties (and serves when nothing else is known).
//
//   detectType(bytes, name?) -> { mime, ext, label, kind, by: 'signature' | 'text' | 'name' | 'none', detail? }
//     bytes: the start of the file (4 KiB is enough for almost everything; 64 KiB finds more inside ZIPs);
//     kind: 'archive' | 'image' | 'audio' | 'video' | 'document' | 'font' | 'executable' | 'text' | 'data'
//   mimeOfName(name) -> { mime, ext, label, kind } | null      by the extension
//   SIGNATURES: the table ({ id, mime, ext, label, kind, at, sig }), for listings
//
// Why content first: names lie (renamed, missing, or attacker-chosen extensions), and security decisions such as
// "is this an image" must not trust them. Detection is a single ordered table scan: the first matching signature
// wins, so ORDER MATTERS: longer / more specific signatures precede shorter ones that they also match (rar5 before
// rar, the 12-byte JPEG XL / JPEG 2000 boxes before anything starting with 00 00 00), and weak 1-2 byte signatures
// (arc 0x1A, pcx, der 30 82, BM, MZ) are validated further in detectType or require a matching extension.

const A = (s) => Array.from(s, (c) => c.charCodeAt(0));
// Signature entries: sig is an array of bytes (null = any byte) found at `at` (default 0).
// `null` in a signature is a wildcard byte (LZH's method id, PCX's version byte).
const S = (id, mime, ext, label, kind, sig, at = 0) => ({ id, mime, ext, label, kind, sig: typeof sig === 'string' ? A(sig) : sig, at });

export const SIGNATURES = [
  // archives and compressed streams
  S('zip', 'application/zip', 'zip', 'ZIP archive', 'archive', [0x50, 0x4b, 0x03, 0x04]),
  S('zip-empty', 'application/zip', 'zip', 'ZIP archive (empty)', 'archive', [0x50, 0x4b, 0x05, 0x06]),
  S('zip-split', 'application/zip', 'zip', 'ZIP archive (split)', 'archive', [0x50, 0x4b, 0x07, 0x08]),
  S('7z', 'application/x-7z-compressed', '7z', '7z archive', 'archive', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  S('rar5', 'application/vnd.rar', 'rar', 'RAR 5 archive', 'archive', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]),
  S('rar', 'application/vnd.rar', 'rar', 'RAR archive', 'archive', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]),
  S('gzip', 'application/gzip', 'gz', 'gzip', 'archive', [0x1f, 0x8b, 0x08]),
  S('bzip2', 'application/x-bzip2', 'bz2', 'bzip2', 'archive', 'BZh'),
  S('xz', 'application/x-xz', 'xz', 'xz', 'archive', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
  S('zstd', 'application/zstd', 'zst', 'Zstandard', 'archive', [0x28, 0xb5, 0x2f, 0xfd]),
  S('lz4', 'application/x-lz4', 'lz4', 'LZ4 frame', 'archive', [0x04, 0x22, 0x4d, 0x18]),
  S('lzip', 'application/x-lzip', 'lz', 'lzip', 'archive', 'LZIP'),
  S('Z', 'application/x-compress', 'Z', 'compress (.Z)', 'archive', [0x1f, 0x9d]),
  S('lzh', 'application/x-lzh-compressed', 'lzh', 'LHA / LZH archive', 'archive', [null, null, 0x2d, 0x6c, 0x68, null, 0x2d]),
  S('arj', 'application/x-arj', 'arj', 'ARJ archive', 'archive', [0x60, 0xea]),
  S('cab', 'application/vnd.ms-cab-compressed', 'cab', 'Microsoft Cabinet', 'archive', 'MSCF\0\0\0\0'),
  S('tar', 'application/x-tar', 'tar', 'tar archive', 'archive', 'ustar', 257),
  S('ar', 'application/x-archive', 'a', 'ar archive', 'archive', '!<arch>\n'),
  S('cpio', 'application/x-cpio', 'cpio', 'cpio archive', 'archive', '07070'),
  S('rpm', 'application/x-rpm', 'rpm', 'RPM package', 'archive', [0xed, 0xab, 0xee, 0xdb]),
  S('xar', 'application/x-xar', 'xar', 'xar archive', 'archive', 'xar!'),
  S('wim', 'application/x-ms-wim', 'wim', 'Windows Imaging', 'archive', 'MSWIM\0\0\0'),
  S('iso', 'application/x-iso9660-image', 'iso', 'ISO 9660 disc image', 'archive', 'CD001', 0x8001),
  S('squashfs', 'application/x-squashfs', 'sqsh', 'SquashFS', 'archive', 'hsqs'),
  S('cramfs', 'application/x-cramfs', 'cramfs', 'cramfs', 'archive', [0x45, 0x3d, 0xcd, 0x28]),
  S('vhdx', 'application/x-vhdx', 'vhdx', 'VHDX disk image', 'archive', 'vhdxfile'),
  S('vmdk', 'application/x-vmdk', 'vmdk', 'VMDK disk image', 'archive', 'KDMV'),
  S('qcow', 'application/x-qemu-disk', 'qcow2', 'QEMU disk image', 'archive', [0x51, 0x46, 0x49, 0xfb]),
  S('arc', 'application/x-arc', 'arc', 'ARC archive', 'archive', [0x1a]),
  // images
  S('png', 'image/png', 'png', 'PNG image', 'image', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  S('jpeg', 'image/jpeg', 'jpg', 'JPEG image', 'image', [0xff, 0xd8, 0xff]),
  S('gif', 'image/gif', 'gif', 'GIF image', 'image', 'GIF8'),
  S('bmp', 'image/bmp', 'bmp', 'BMP image', 'image', 'BM'),
  S('tiff-le', 'image/tiff', 'tif', 'TIFF image', 'image', [0x49, 0x49, 0x2a, 0x00]),
  S('tiff-be', 'image/tiff', 'tif', 'TIFF image', 'image', [0x4d, 0x4d, 0x00, 0x2a]),
  S('bigtiff', 'image/tiff', 'tif', 'BigTIFF image', 'image', [0x49, 0x49, 0x2b, 0x00]),
  S('ico', 'image/x-icon', 'ico', 'Windows icon', 'image', [0x00, 0x00, 0x01, 0x00]),
  S('cur', 'image/x-icon', 'cur', 'Windows cursor', 'image', [0x00, 0x00, 0x02, 0x00]),
  S('icns', 'image/x-icns', 'icns', 'Apple icon', 'image', 'icns'),
  S('psd', 'image/vnd.adobe.photoshop', 'psd', 'Photoshop document', 'image', '8BPS'),
  S('jxl', 'image/jxl', 'jxl', 'JPEG XL image', 'image', [0xff, 0x0a]),
  S('jxl-box', 'image/jxl', 'jxl', 'JPEG XL image', 'image', [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
  S('jp2', 'image/jp2', 'jp2', 'JPEG 2000 image', 'image', [0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
  S('qoi', 'image/qoi', 'qoi', 'QOI image', 'image', 'qoif'),
  S('exr', 'image/x-exr', 'exr', 'OpenEXR image', 'image', [0x76, 0x2f, 0x31, 0x01]),
  S('dds', 'image/vnd.ms-dds', 'dds', 'DirectDraw surface', 'image', 'DDS '),
  S('pcx', 'image/x-pcx', 'pcx', 'PCX image', 'image', [0x0a, null, 0x01]),
  S('xcf', 'image/x-xcf', 'xcf', 'GIMP image', 'image', 'gimp xcf'),
  S('hdr', 'image/vnd.radiance', 'hdr', 'Radiance HDR image', 'image', '#?RADIANCE'),
  S('pbm', 'image/x-portable-anymap', 'pnm', 'Netpbm image', 'image', [0x50, null, 0x0a]),
  // audio
  S('mp3-id3', 'audio/mpeg', 'mp3', 'MP3 audio (ID3)', 'audio', 'ID3'),
  S('flac', 'audio/flac', 'flac', 'FLAC audio', 'audio', 'fLaC'),
  S('midi', 'audio/midi', 'mid', 'MIDI', 'audio', 'MThd'),
  S('aiff', 'audio/aiff', 'aiff', 'AIFF audio', 'audio', 'FORM'),
  S('au', 'audio/basic', 'au', 'Sun audio', 'audio', '.snd'),
  S('amr', 'audio/amr', 'amr', 'AMR audio', 'audio', '#!AMR'),
  S('ape', 'audio/x-ape', 'ape', "Monkey's Audio", 'audio', 'MAC '),
  S('wavpack', 'audio/x-wavpack', 'wv', 'WavPack', 'audio', 'wvpk'),
  S('mpc', 'audio/x-musepack', 'mpc', 'Musepack', 'audio', 'MPCK'),
  S('ogg', 'audio/ogg', 'ogg', 'Ogg', 'audio', 'OggS'),
  S('riff', 'application/octet-stream', 'riff', 'RIFF', 'data', 'RIFF'),
  S('wma', 'video/x-ms-asf', 'asf', 'ASF / WMA / WMV', 'video', [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]),
  // video
  S('ebml', 'video/x-matroska', 'mkv', 'Matroska', 'video', [0x1a, 0x45, 0xdf, 0xa3]),
  S('flv', 'video/x-flv', 'flv', 'Flash video', 'video', 'FLV\x01'),
  S('mpeg-ps', 'video/mpeg', 'mpg', 'MPEG program stream', 'video', [0x00, 0x00, 0x01, 0xba]),
  S('mpeg-es', 'video/mpeg', 'mpg', 'MPEG video', 'video', [0x00, 0x00, 0x01, 0xb3]),
  S('ftyp', 'video/mp4', 'mp4', 'ISO media', 'video', 'ftyp', 4),
  S('mov-moov', 'video/quicktime', 'mov', 'QuickTime movie', 'video', 'moov', 4),
  S('mov-mdat', 'video/quicktime', 'mov', 'QuickTime movie', 'video', 'mdat', 4),
  // documents
  S('pdf', 'application/pdf', 'pdf', 'PDF document', 'document', '%PDF-'),
  S('ps', 'application/postscript', 'ps', 'PostScript', 'document', '%!PS'),
  S('rtf', 'application/rtf', 'rtf', 'Rich Text', 'document', '{\\rtf'),
  S('cfb', 'application/x-ole-storage', 'cfb', 'Compound file (OLE)', 'document', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  S('djvu', 'image/vnd.djvu', 'djvu', 'DjVu document', 'document', 'AT&TFORM'),
  S('chm', 'application/vnd.ms-htmlhelp', 'chm', 'Compiled HTML help', 'document', 'ITSF'),
  S('mobi', 'application/x-mobipocket-ebook', 'mobi', 'Mobipocket e-book', 'document', 'BOOKMOBI', 60),
  S('fb2', 'application/x-fictionbook+xml', 'fb2', 'FictionBook', 'document', '<FictionBook'),
  S('kdbx', 'application/x-keepass2', 'kdbx', 'KeePass database', 'data', [0x03, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5]),
  S('sqlite', 'application/vnd.sqlite3', 'sqlite', 'SQLite database', 'data', 'SQLite format 3\0'),
  S('parquet', 'application/vnd.apache.parquet', 'parquet', 'Parquet', 'data', 'PAR1'),
  S('pgp', 'application/pgp-encrypted', 'gpg', 'OpenPGP data', 'data', [0x85, null, null, 0x03]),
  S('der', 'application/pkix-cert', 'der', 'DER certificate / key', 'data', [0x30, 0x82]),
  S('wasm', 'application/wasm', 'wasm', 'WebAssembly', 'executable', [0x00, 0x61, 0x73, 0x6d]),
  S('torrent', 'application/x-bittorrent', 'torrent', 'BitTorrent', 'data', 'd8:announce'),
  S('swf', 'application/x-shockwave-flash', 'swf', 'Flash', 'executable', 'FWS'),
  S('swf-z', 'application/x-shockwave-flash', 'swf', 'Flash (compressed)', 'executable', 'CWS'),
  S('blend', 'application/x-blender', 'blend', 'Blender file', 'data', 'BLENDER'),
  S('glb', 'model/gltf-binary', 'glb', 'glTF binary', 'data', 'glTF'),
  S('stl', 'model/stl', 'stl', 'STL model', 'data', 'solid '),
  S('dwg', 'image/vnd.dwg', 'dwg', 'AutoCAD drawing', 'document', 'AC10'),
  S('pcap', 'application/vnd.tcpdump.pcap', 'pcap', 'Packet capture', 'data', [0xd4, 0xc3, 0xb2, 0xa1]),
  S('pcapng', 'application/x-pcapng', 'pcapng', 'Packet capture (pcapng)', 'data', [0x0a, 0x0d, 0x0d, 0x0a]),
  // fonts
  S('woff', 'font/woff', 'woff', 'WOFF font', 'font', 'wOFF'),
  S('woff2', 'font/woff2', 'woff2', 'WOFF2 font', 'font', 'wOF2'),
  S('otf', 'font/otf', 'otf', 'OpenType font', 'font', 'OTTO'),
  S('ttf', 'font/ttf', 'ttf', 'TrueType font', 'font', [0x00, 0x01, 0x00, 0x00, 0x00]),
  S('ttc', 'font/collection', 'ttc', 'Font collection', 'font', 'ttcf'),
  S('eot', 'application/vnd.ms-fontobject', 'eot', 'Embedded OpenType', 'font', 'LP', 34),
  // executables
  S('pe', 'application/vnd.microsoft.portable-executable', 'exe', 'Windows executable', 'executable', 'MZ'),
  S('elf', 'application/x-elf', 'elf', 'ELF executable', 'executable', [0x7f, 0x45, 0x4c, 0x46]),
  S('macho32', 'application/x-mach-binary', 'macho', 'Mach-O executable', 'executable', [0xfe, 0xed, 0xfa, 0xce]),
  S('macho64', 'application/x-mach-binary', 'macho', 'Mach-O executable', 'executable', [0xcf, 0xfa, 0xed, 0xfe]),
  S('macho64be', 'application/x-mach-binary', 'macho', 'Mach-O executable', 'executable', [0xfe, 0xed, 0xfa, 0xcf]),
  S('macho-le', 'application/x-mach-binary', 'macho', 'Mach-O executable', 'executable', [0xce, 0xfa, 0xed, 0xfe]),
  S('fat', 'application/x-mach-binary', 'macho', 'Mach-O universal binary / Java class', 'executable', [0xca, 0xfe, 0xba, 0xbe]),
  S('dex', 'application/vnd.android.dex', 'dex', 'Android Dalvik executable', 'executable', 'dex\n'),
  S('lnk', 'application/x-ms-shortcut', 'lnk', 'Windows shortcut', 'data', [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00]),
  S('dmp', 'application/x-dmp', 'dmp', 'Windows memory dump', 'data', 'MDMP'),
];

const EXT = {};
for (const s of SIGNATURES) if (!EXT[s.ext]) EXT[s.ext] = s;
// Types known by extension only (text formats and containers refined from a generic signature).
const NAMED = [
  ['txt', 'text/plain', 'Text', 'text'], ['md', 'text/markdown', 'Markdown', 'text'], ['csv', 'text/csv', 'CSV', 'text'], ['tsv', 'text/tab-separated-values', 'TSV', 'text'],
  ['html', 'text/html', 'HTML', 'text'], ['htm', 'text/html', 'HTML', 'text'], ['css', 'text/css', 'CSS', 'text'], ['js', 'text/javascript', 'JavaScript', 'text'],
  ['mjs', 'text/javascript', 'JavaScript', 'text'], ['ts', 'text/typescript', 'TypeScript', 'text'], ['json', 'application/json', 'JSON', 'text'], ['xml', 'application/xml', 'XML', 'text'],
  ['svg', 'image/svg+xml', 'SVG image', 'image'], ['yaml', 'application/yaml', 'YAML', 'text'], ['yml', 'application/yaml', 'YAML', 'text'], ['toml', 'application/toml', 'TOML', 'text'],
  ['ini', 'text/plain', 'INI', 'text'], ['log', 'text/plain', 'Log', 'text'], ['sh', 'application/x-sh', 'Shell script', 'text'], ['py', 'text/x-python', 'Python', 'text'],
  ['c', 'text/x-c', 'C source', 'text'], ['h', 'text/x-c', 'C header', 'text'], ['cpp', 'text/x-c++', 'C++ source', 'text'], ['java', 'text/x-java', 'Java source', 'text'],
  ['rs', 'text/x-rust', 'Rust source', 'text'], ['go', 'text/x-go', 'Go source', 'text'], ['php', 'application/x-httpd-php', 'PHP', 'text'], ['sql', 'application/sql', 'SQL', 'text'],
  ['bat', 'application/x-bat', 'Batch file', 'text'], ['ps1', 'text/plain', 'PowerShell', 'text'], ['srt', 'application/x-subrip', 'Subtitles', 'text'], ['vtt', 'text/vtt', 'WebVTT', 'text'],
  ['ics', 'text/calendar', 'Calendar', 'text'], ['vcf', 'text/vcard', 'vCard', 'text'], ['eml', 'message/rfc822', 'E-mail message', 'text'], ['pem', 'application/x-pem-file', 'PEM', 'text'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word document', 'document'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel workbook', 'document'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PowerPoint presentation', 'document'],
  ['odt', 'application/vnd.oasis.opendocument.text', 'OpenDocument text', 'document'], ['ods', 'application/vnd.oasis.opendocument.spreadsheet', 'OpenDocument spreadsheet', 'document'],
  ['odp', 'application/vnd.oasis.opendocument.presentation', 'OpenDocument presentation', 'document'], ['odg', 'application/vnd.oasis.opendocument.graphics', 'OpenDocument drawing', 'document'],
  ['epub', 'application/epub+zip', 'EPUB e-book', 'document'], ['jar', 'application/java-archive', 'Java archive', 'archive'], ['apk', 'application/vnd.android.package-archive', 'Android package', 'archive'],
  ['xpi', 'application/x-xpinstall', 'Browser extension', 'archive'], ['kmz', 'application/vnd.google-earth.kmz', 'KMZ', 'document'], ['3mf', 'model/3mf', '3MF model', 'data'],
  ['doc', 'application/msword', 'Word 97-2003 document', 'document'], ['xls', 'application/vnd.ms-excel', 'Excel 97-2003 workbook', 'document'],
  ['ppt', 'application/vnd.ms-powerpoint', 'PowerPoint 97-2003', 'document'], ['msi', 'application/x-msi', 'Windows installer', 'executable'], ['msg', 'application/vnd.ms-outlook', 'Outlook message', 'document'],
  ['wav', 'audio/wav', 'WAV audio', 'audio'], ['avi', 'video/x-msvideo', 'AVI video', 'video'], ['webp', 'image/webp', 'WebP image', 'image'], ['ani', 'application/x-navi-animation', 'Animated cursor', 'image'],
  ['mp4', 'video/mp4', 'MP4 video', 'video'], ['m4a', 'audio/mp4', 'MPEG-4 audio', 'audio'], ['m4v', 'video/x-m4v', 'MPEG-4 video', 'video'], ['mov', 'video/quicktime', 'QuickTime movie', 'video'],
  ['3gp', 'video/3gpp', '3GPP video', 'video'], ['heic', 'image/heic', 'HEIC image', 'image'], ['heif', 'image/heif', 'HEIF image', 'image'], ['avif', 'image/avif', 'AVIF image', 'image'],
  ['webm', 'video/webm', 'WebM video', 'video'], ['mkv', 'video/x-matroska', 'Matroska video', 'video'], ['mka', 'audio/x-matroska', 'Matroska audio', 'audio'],
  ['opus', 'audio/opus', 'Opus audio', 'audio'], ['oga', 'audio/ogg', 'Ogg audio', 'audio'], ['ogv', 'video/ogg', 'Ogg video', 'video'], ['mp3', 'audio/mpeg', 'MP3 audio', 'audio'],
  ['aac', 'audio/aac', 'AAC audio', 'audio'], ['m2ts', 'video/mp2t', 'MPEG transport stream', 'video'],
  ['tgz', 'application/gzip', 'tar.gz', 'archive'], ['tbz2', 'application/x-bzip2', 'tar.bz2', 'archive'], ['txz', 'application/x-xz', 'tar.xz', 'archive'], ['tzst', 'application/zstd', 'tar.zst', 'archive'],
  ['dll', 'application/vnd.microsoft.portable-executable', 'Windows library', 'executable'], ['so', 'application/x-sharedlib', 'Shared library', 'executable'], ['class', 'application/java-vm', 'Java class', 'executable'],
  ['deb', 'application/vnd.debian.binary-package', 'Debian package', 'archive'], ['dmg', 'application/x-apple-diskimage', 'Apple disk image', 'archive'],
];
// Null-prototype map: an extension such as 'constructor' or '__proto__' cannot hit Object.prototype.
const BY_EXT = Object.create(null);
for (const s of SIGNATURES) if (!BY_EXT[s.ext]) BY_EXT[s.ext] = { mime: s.mime, ext: s.ext, label: s.label, kind: s.kind };
for (const [ext, mime, label, kind] of NAMED) BY_EXT[ext] = { mime, ext, label, kind };
BY_EXT.jpeg = BY_EXT.jpg; BY_EXT.tiff = BY_EXT.tif; BY_EXT.gzip = BY_EXT.gz; BY_EXT.midi = BY_EXT.mid; BY_EXT.zstd = BY_EXT.zst; BY_EXT.aif = BY_EXT.aiff;

const extOf = (name) => { const m = /\.([^./\\]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };

export function mimeOfName(name) {
  const n = String(name || '').toLowerCase();
  if (/\.tar\.(gz|bz2|xz|zst|lzma|z)$/.test(n)) { const t = BY_EXT[n.slice(n.lastIndexOf('.') + 1)] || BY_EXT.tar; return { ...t, label: 'tar.' + n.slice(n.lastIndexOf('.') + 1) }; }
  return BY_EXT[extOf(name)] || null;
}

const at = (b, sig, o = 0) => { if (b.length < o + sig.length) return false; for (let i = 0; i < sig.length; i++) if (sig[i] != null && b[o + i] !== sig[i]) return false; return true; };
const str = (b, o, n) => { let s = ''; for (let i = o; i < Math.min(b.length, o + n); i++) s += String.fromCharCode(b[i]); return s; };
const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const result = (t, by, detail) => ({ mime: t.mime, ext: t.ext, label: t.label, kind: t.kind, by, ...(detail ? { detail } : {}) });
const named = (ext, by = 'signature', detail) => result(BY_EXT[ext], by, detail);

// --- refinements of containers -----------------------------------------------------------------------------------

// Walks local headers at the start of the buffer (the central directory is at the end and may not be loaded).
// ODF / EPUB require a stored 'mimetype' first entry, which identifies them exactly; OOXML is recognised by its part
// folders. A data descriptor (flag 8) with zero csize means the next header cannot be located, so the walk stops.
function refineZip(b) {
  // Names of the first local headers (and the stored 'mimetype' of ODF / EPUB).
  const names = [];
  let mimetype = null;
  for (let o = 0; o + 30 <= b.length && names.length < 64;) {
    if (le32(b, o) !== 0x04034b50) break;
    const flags = le16(b, o + 6), method = le16(b, o + 8), csize = le32(b, o + 18), nl = le16(b, o + 26), xl = le16(b, o + 28);
    const name = str(b, o + 30, nl);
    names.push(name);
    if (name === 'mimetype' && method === 0) mimetype = str(b, o + 30 + nl + xl, Math.min(csize, 100)).trim();
    if (flags & 8 && !csize) break; // data descriptor: sizes unknown here
    o += 30 + nl + xl + csize;
  }
  if (mimetype) {
    const m = { 'application/epub+zip': 'epub', 'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods',
      'application/vnd.oasis.opendocument.presentation': 'odp', 'application/vnd.oasis.opendocument.graphics': 'odg' }[mimetype];
    if (m) return named(m);
  }
  const has = (re) => names.some((n) => re.test(n));
  if (has(/^word\//)) return named('docx');
  if (has(/^xl\//)) return named('xlsx');
  if (has(/^ppt\//)) return named('pptx');
  if (has(/^\[Content_Types\]\.xml$/)) {
    if (has(/^3D\//)) return named('3mf');
    return { mime: 'application/vnd.openxmlformats-package', ext: 'zip', label: 'Office Open XML package', kind: 'document', by: 'signature' };
  }
  if (has(/^AndroidManifest\.xml$|^classes\.dex$/)) return named('apk');
  if (has(/^META-INF\/MANIFEST\.MF$/) || has(/\.class$/)) return named('jar');
  if (has(/^manifest\.json$/) && has(/^META-INF\/mozilla\.rsa$/i)) return named('xpi');
  if (has(/^doc\.kml$/)) return named('kmz');
  return null;
}

function refineRiff(b) {
  const form = str(b, 8, 4);
  if (form === 'WAVE') return named('wav');
  if (form === 'AVI ') return named('avi');
  if (form === 'WEBP') return named('webp');
  if (form === 'ACON') return named('ani');
  if (form === 'RMID') return named('mid');
  return { mime: 'application/x-riff', ext: 'riff', label: 'RIFF (' + form.trim() + ')', kind: 'data', by: 'signature' };
}

// ISO BMFF: the major brand and compatible brands in the ftyp box name the profile. HEIF / AVIF checks come before
// the generic MP4 fallback because those files also list 'mp41' / 'isom' among compatible brands.
function refineFtyp(b) {
  const size = be32(b, 0);
  const brands = [str(b, 8, 4)];
  for (let o = 16; o + 4 <= Math.min(size, b.length, 64); o += 4) brands.push(str(b, o, 4));
  const any = (...xs) => brands.some((x) => xs.includes(x));
  const major = brands[0];
  if (any('avif', 'avis')) return named('avif');
  if (any('heic', 'heix', 'heim', 'heis', 'hevc', 'hevx')) return named('heic');
  if (any('mif1', 'msf1') && !any('isom', 'mp41', 'mp42')) return named('heif');
  if (major === 'qt  ') return named('mov');
  if (/^3g[2gp]/.test(major)) return named('3gp');
  if (major === 'M4A ' || major === 'M4B ' || major === 'F4A ') return named('m4a');
  if (major === 'M4V ' || major === 'M4VH' || major === 'M4VP') return named('m4v');
  if (major === 'crx ') return { mime: 'image/x-canon-cr3', ext: 'cr3', label: 'Canon raw image', kind: 'image', by: 'signature' };
  if (major === 'jxl ') return result(EXT.jxl, 'signature');
  return named('mp4', 'signature', 'brand ' + major.trim());
}

function refineOgg(b) {
  // The first page carries the codec's identification header.
  const segs = b[26] || 0, p = 27 + segs;
  const head = str(b, p, 8);
  if (head.startsWith('OpusHead')) return named('opus');
  if (head.startsWith('\x01vorbis')) return { ...named('oga'), label: 'Ogg Vorbis audio' };
  if (head.startsWith('\x7fFLAC')) return { ...named('oga'), label: 'Ogg FLAC audio' };
  if (head.startsWith('\x80theora')) return named('ogv');
  if (head.startsWith('Speex')) return { ...named('oga'), label: 'Ogg Speex audio' };
  return named('oga');
}

function refineEbml(b) {
  // DocType element (0x4282) in the EBML header.
  for (let i = 4; i + 3 < Math.min(b.length, 64); i++) {
    if (b[i] === 0x42 && b[i + 1] === 0x82) {
      const len = b[i + 2] & 0x7f;
      const t = str(b, i + 3, len);
      if (t === 'webm') return named('webm');
      if (t === 'matroska') return named('mkv');
      break;
    }
  }
  return named('mkv');
}

// Compound File Binary: the directory starts at sector (first directory sector + 1) * sector size, the +1 skipping
// the header sector. The root entry's CLSID identifies MSI; otherwise stream names are searched as text after
// stripping the UTF-16 NULs (a cheap approximation of parsing the directory).
function refineCfb(b, ext) {
  // Office 97-2003 and MSI share the compound file container: the root CLSID or the name decide.
  const sector = 1 << (le16(b, 0x1e) || 9), dir = (le32(b, 0x30) + 1) * sector;
  const clsid = Array.from(b.subarray(dir + 0x50, dir + 0x60)).map((x) => x.toString(16).padStart(2, '0')).join('');
  if (clsid.startsWith('84100c0000000000c000000000000046')) return named('msi');
  if (ext === 'doc' || ext === 'xls' || ext === 'ppt' || ext === 'msi' || ext === 'msg') return named(ext);
  // Stream names in the first directory sector (UTF-16).
  const text = str(b, 0, b.length).replace(/\0/g, '');
  if (/WordDocument/.test(text)) return named('doc');
  if (/Workbook|Book/.test(text)) return named('xls');
  if (/PowerPoint Document/.test(text)) return named('ppt');
  if (/__substg1\.0_/.test(text)) return named('msg');
  return null;
}

// MPEG audio frame sync: 11 set bits. Reserved version / bitrate / sample-rate values are rejected to reduce false
// positives on random data (a lone FF Ex pair is common in binary files).
function mp3Frame(b) {
  if (b.length < 4 || b[0] !== 0xff || (b[1] & 0xe0) !== 0xe0) return null;
  const ver = (b[1] >> 3) & 3, layer = (b[1] >> 1) & 3, rate = b[2] >> 4, sr = (b[2] >> 2) & 3;
  if (ver === 1 || rate === 15 || rate === 0 || sr === 3) return null;
  if (layer === 0) {
    // ADTS (AAC) uses the same sync word with layer 0.
    return (b[1] & 0xf6) === 0xf0 ? named('aac') : null;
  }
  return named('mp3');
}

// --- text ---------------------------------------------------------------------------------------------------------

// Text heuristic: any NUL byte means binary (UTF-16 without BOM is therefore not text here); more than 1 % control
// characters (other than tab, newlines, form feed, ESC) means binary. The UTF-8 check excludes the last 4 bytes of a
// truncated sample so a multi-byte character cut at the boundary does not misclassify the file as 8-bit.
function sniffText(b, ext) {
  let o = 0, enc = '';
  if (at(b, [0xef, 0xbb, 0xbf])) { o = 3; enc = 'UTF-8 BOM'; }
  else if (at(b, [0xff, 0xfe, 0, 0])) return { ...named('txt', 'text'), detail: 'UTF-32 LE' };
  else if (at(b, [0xff, 0xfe])) return { ...named('txt', 'text'), detail: 'UTF-16 LE' };
  else if (at(b, [0xfe, 0xff])) return { ...named('txt', 'text'), detail: 'UTF-16 BE' };
  const n = Math.min(b.length, 8192);
  let ctl = 0, high = 0;
  for (let i = o; i < n; i++) { const c = b[i]; if (c === 0) return null; if (c < 9 || (c > 13 && c < 32 && c !== 27)) ctl++; if (c > 127) high++; }
  if (ctl > n / 100 + 1) return null;
  if (!enc) {
    let utf8 = true;
    try { new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, n - (n === b.length ? 0 : 4))); } catch { utf8 = false; }
    enc = high ? (utf8 ? 'UTF-8' : '8-bit') : 'ASCII';
  }
  const head = str(b, o, 1024).replace(/^\s+/, '');
  const low = head.slice(0, 256).toLowerCase();
  const t = (x) => ({ ...named(x, 'text'), detail: enc });
  if (/^<!doctype html|^<html[\s>]|^<head[\s>]|^<body[\s>]/.test(low)) return t('html');
  if (/^<svg[\s>]/.test(low) || (/^<\?xml/.test(low) && /<svg[\s>]/.test(head.toLowerCase()))) return t('svg');
  if (/^<\?xml/.test(low)) return /<fictionbook/i.test(head) ? result(EXT.fb2, 'text', enc) : t('xml');
  if (/^%pdf-/.test(low)) return result(EXT.pdf, 'signature');
  if (/^#!/.test(head)) { const m = /^#!\s*(\S+)(?:[ \t]+(\S+))?/.exec(head) || []; const base = (m[1] || '').replace(/^.*\//, ''); const prog = (base === 'env' ? m[2] : base) || ''; return t(/python/.test(prog) ? 'py' : /node|deno|bun/.test(prog) ? 'js' : 'sh'); }
  if (/^-----begin [a-z0-9 ]+-----/.test(low)) return t('pem');
  if (/^begin:vcalendar/.test(low)) return t('ics');
  if (/^begin:vcard/.test(low)) return t('vcf');
  if (/^webvtt/.test(low)) return t('vtt');
  // JSON is confirmed by parsing when the sample is the whole file; for a truncated sample a plausible JSON start is
  // accepted, since the tail cannot be parsed.
  if (/^[{[]/.test(head) && ext !== 'js') {
    try { JSON.parse(new TextDecoder().decode(b.subarray(o))); return t('json'); } catch { if (b.length >= 8192 && /^[{[]\s*["{[\d\-tfn\]}]/.test(head)) return t('json'); }
  }
  if (BY_EXT[ext] && BY_EXT[ext].kind === 'text') return t(ext);
  if (ext === 'svg' || ext === 'ts') return t(ext);
  return t('txt');
}

// --- detection ----------------------------------------------------------------------------------------------------

// The switch holds per-format validation for signatures too weak to trust alone; `continue` rejects the match and
// lets the scan try the next signature, `return` / `break` accept it.
export function detectType(bytes, name = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const ext = extOf(name);
  if (!b.length) return { mime: 'application/x-empty', ext: '', label: 'Empty', kind: 'data', by: 'none' };
  for (const s of SIGNATURES) {
    if (!at(b, s.sig, s.at)) continue;
    switch (s.id) {
      case 'zip': return refineZip(b) || result(s, 'signature');
      case 'riff': return refineRiff(b);
      case 'ftyp': return refineFtyp(b);
      case 'ogg': return refineOgg(b);
      case 'ebml': return refineEbml(b);
      case 'cfb': return refineCfb(b, ext) || result(s, 'signature');
      case 'aiff': if (!/^AIF[FC]$/.test(str(b, 8, 4))) { if (str(b, 8, 4) === 'DJVU' || str(b, 8, 4) === 'DJVM') continue; return { mime: 'application/x-iff', ext: 'iff', label: 'IFF (' + str(b, 8, 4) + ')', kind: 'data', by: 'signature' }; } break;
      case 'bmp': if (!(le32(b, 14) === 12 || le32(b, 14) === 40 || le32(b, 14) === 52 || le32(b, 14) === 56 || le32(b, 14) === 64 || le32(b, 14) === 108 || le32(b, 14) === 124)) continue; break;
      case 'ico': case 'cur': if (!(le16(b, 4) > 0 && le16(b, 4) < 256 && (b[9] === 0 || b[9] === 255) && b.length >= 22)) continue; break;
      case 'pe': {
        const pe = le32(b, 0x3c);
        if (pe + 24 <= b.length && le32(b, pe) === 0x4550) {
          const dll = le16(b, pe + 22) & 0x2000;
          const mach = { 0x14c: 'x86', 0x8664: 'x64', 0x1c0: 'ARM', 0xaa64: 'ARM64', 0x200: 'IA-64' }[le16(b, pe + 4)] || '';
          return dll ? { ...named('dll'), detail: mach } : result(s, 'signature', mach);
        }
        return { ...result(s, 'signature'), label: 'DOS executable' };
      }
      case 'elf': {
        const t = { 1: 'relocatable', 2: 'executable', 3: 'shared object', 4: 'core dump' }[b[5] === 2 ? b[17] : b[16]] || '';
        return result(s, 'signature', [b[4] === 2 ? '64-bit' : '32-bit', t].filter(Boolean).join(', '));
      }
      case 'fat': if (be32(b, 4) > 30) return { mime: 'application/java-vm', ext: 'class', label: 'Java class', kind: 'executable', by: 'signature' }; break;
      case 'tar': break;
      case 'arc': if (!(b[1] >= 1 && b[1] <= 11) || b.length < 29) continue; break;
      case 'pcx': if (b[3] !== 1 && b[3] !== 2 && b[3] !== 4 && b[3] !== 8) continue; break;
      case 'pbm': if (!(b[1] >= 0x31 && b[1] <= 0x37)) continue; break;
      case 'der': if (!(ext === 'der' || ext === 'cer' || ext === 'crt' || ext === 'p12' || ext === 'pfx' || ext === 'key')) continue; break;
      case 'ttf': break;
      case 'stl': if (ext !== 'stl') continue; break;
      case 'pgp': if (ext !== 'gpg' && ext !== 'pgp') continue; break;
      case 'mp3-id3': {
        // ID3 tags precede the audio: skip the tag and look at the frame (AAC / FLAC behind ID3 exist too).
        const len = ((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127);
        const rest = b.subarray(10 + len + (b[5] & 0x10 ? 10 : 0));
        if (at(rest, A('fLaC'))) return result(EXT.flac, 'signature');
        const f = mp3Frame(rest);
        return f || result(s, 'signature');
      }
      case 'gzip': if (/^(tgz|taz)$/.test(ext) || /\.tar\.gz$/i.test(name)) return { ...result(s, 'signature'), label: 'tar.gz' }; break;
      default: break;
    }
    return result(s, 'signature');
  }
  // Signatures that are not at the start or need more than a byte comparison (byte order marks first: FF FE
  // looks like an MPEG frame sync).
  // BOMs before the MPEG sync test: FF FE / FF FB look like frame headers.
  if (at(b, [0xef, 0xbb, 0xbf]) || at(b, [0xff, 0xfe]) || at(b, [0xfe, 0xff])) return sniffText(b, ext);
  const mp3 = mp3Frame(b);
  if (mp3) return mp3;
  // MPEG transport stream: sync byte 0x47 repeating every 188 bytes, checked at two or three packet starts.
  if (b.length >= 188 * 2 && b[0] === 0x47 && b[188] === 0x47 && (b.length < 188 * 3 || b[376] === 0x47)) return named('m2ts');
  if (b[0] === 0x5d && b[1] === 0 && b[2] === 0 && b[13] === 0 && b.length > 14) return { mime: 'application/x-lzma', ext: 'lzma', label: 'LZMA', kind: 'archive', by: 'signature' };
  if (str(b, 0, 5) === 'MThd') return named('mid');
  if (at(b, [0x00, 0x00, 0x00]) && b[3] >= 0x14 && str(b, 4, 4) === 'ftyp') return refineFtyp(b);
  const txt = sniffText(b, ext);
  if (txt) return txt;
  const byName = mimeOfName(name);
  if (byName) return { ...byName, by: 'name' };
  return { mime: 'application/octet-stream', ext: '', label: 'Binary data', kind: 'data', by: 'none' };
}
