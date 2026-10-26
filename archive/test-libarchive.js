// archive/test-libarchive.js - real-world archives from libarchive's test suite and recovery paths:
// `node archive/test-libarchive.js` (importing the module runs nothing).
//
// The embedded archives are fixtures of libarchive (https://github.com/libarchive/libarchive, libarchive/test,
// BSD-2-Clause licence, Copyright (c) Tim Kientzle and the libarchive contributors), base64 of the decoded .uu files.
// They cover what no tool on this machine can write: RAR 2.9 compressed data (LZ with the low-distance reset, PPMd
// with a DELTA filter), RAR 3.x AES-128 data and header encryption, RAR 5 file versions and solid AES-256, PKWARE strong
// encryption (SecureZIP AES-256), a ZIP without a valid end record, and ISO 9660 images with a 68-byte root record and
// a Rock Ridge relocation without its child link. Expected contents come from libarchive's test_read_format_*.c; the
// archives' own CRC-32 checks pass, and 7-Zip / bsdtar extract the same bytes. The ZIP local-header scan (truncated
// downloads, streamed archives with data descriptors) is tested with archives built here.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from '../codec/crc32.js';
import { Reader, bytesSource, readAll, sourceStream } from './io.js';
import { lzwStream } from './gzip.js';
import { openArchive } from './index.js';
import { scanLocalHeaders } from './zip.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Fixtures from libarchive's test suite (BSD-2-Clause), named without the test_read_format_ prefix.
const FIXTURES = {
  'rar3_lowdist_reset.rar':
    'UmFyIRoHAM+QcwAADQAAAAAAAABqUXQAgDEA6gEAAEAAAAAD3Dj4bwAAAAAdNREAIAAAAGxvd2Rpc3QtcmVzZXQuYmluERERERER' +
    'FVVVVWIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIi' +
    'IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZm' +
    'ZmZmZVVVmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmREREREREREVUREVVVVVVVVVVVVVVVVAAECAwQFBgcICQoLDA0ODxARE' +
    'hMUFRYXGBkaGxwdHh8gISIjJCUmJ/IcvkO/1YBERERERERVVVVViIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIi' +
    'IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiImZmZmZm' +
    'ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmVVVZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZkRERERERER' +
    'FVERFVVVVVVVVVVVVVVVfIcBQUlRWWFpcXmBiZGZoam3VMQ9ewBABwA=',
  'rar4_encrypted.rar':
    'UmFyIRoHAM+QcwAADQAAAAAAAAAqY3QgkCoAEgAAABIAAAACVW5a7mRXdlgdMAUAIAAAAGEudHh0APD8TBtUaGlzIGlzIGZyb20g' +
    'YS50eHRfjnQklDIAIAAAABIAAAAChRT6qWdXdlgdMwUAIAAAAGIudHh0vgIbmnkqilUAsHKgNMn59g0Qf6jR1nzr1KS2yNRrgooe' +
    'n66wDfjatsdECurku8d0IJAqABIAAAASAAAAAjU9mpRuV3ZYHTAFACAAAABjLnR4dACwPkgtVGhpcyBpcyBmcm9tIGMudHh07cp0' +
    'JJQyACAAAAASAAAAAiXhuiZNZHZYHTMFACAAAABkLnR4dK/ifRPzpVNSAPD7YY92+D/JR2gbUC02jMB4ydOpRar2iQPcvhjgjGZX' +
    '2wT16cQ9ewBABwA=',
  'rar4_solid_encrypted.rar':
    'UmFyIRoHADvQcwgADQAAAAAAAAAhYXTElDIAMAAAABIAAAACVW5a7mRXdlgdMwUAIAAAAGEudHh0AAAAAAAAAAAA8PxMG9xMy2AT' +
    '2JoRQ/GDngHm6HgELpF34wfhD4txehNkP8ZxoByLM9h2IYmKtxkTOc2AzjZWdNSUMgAQAAAAEgAAAAKFFPqpZ1d2WB0zBQAgAAAA' +
    'Yi50eHSPFtXIQVCs9QCwcqA0irXtBqoJ/a/Yr88rM1/4e8MjdNSUMgAQAAAAEgAAAAI1PZqUbld2WB0zBQAgAAAAYy50eHRpsiac' +
    'gSJgtgCwPkgtkH1h9ySu+/ngRBsNof2erN02dNSUMgAQAAAAEgAAAAIl4bomTWR2WB0zBQAgAAAAZC50eHSjLhrkrtsFzQDw+2GP' +
    'fqMsDgeBVSdtOdwwjhqmpsQ9ewBABwA=',
  'rar4_encrypted_filenames.rar':
    'UmFyIRoHAM6Zc4AADQAAAAAAAAAAAAAAAAAAAHQLhjMoMLWHQDJeY20c4vaKVtHClR72L6r0d23BE5Sd3EMg5SU6+Cs/bn2n8KU9' +
    'GCWixDfgW04TYlx8Y8UNczV1XqthmOHsTsvvjtW98xWQjVRzOJ+HWtvn/yck3YlnIAAAAAAAAAAAIiMI9vV7WRujtH8xZ7GclVkW' +
    'mWAf3pADNOI9qf3+jZB1NVv+SdHwLVrIlk7apU0dQP6o2x7mYowi6cL3hOK0VcyErLYGPvy/8iuY2V22t9CVmaEU5a8qyMJMF9MR' +
    'yb6eAAAAAAAAAADKiQEJRlpi77vZY9M4Qk0eoAuLGKOuuwrB9R4qDIhm/0mWQmlTBsQOR0LdpcH476QamST1/7WzOpa6uxO8go68' +
    '9GQsPwazhEaM5c+UOhB8zikXurV72lPZEZrPuSA7X90AAAAAAAAAAO8E6Tfe/6OTKeWcRSFXURfW/OPhBa4hBwCiQwzVVeLFqJNo' +
    'EQ0BPPeEH9HN1f/Cvduf/azulc+VU6TP7YMt+mfWTWJ4v1uszUg88ugRqD6P2fqc/4zejuhSRMcxbcbj7gAAAAAAAAAA8J9Fd+s8' +
    'JNpIkqv+eRXXow==',
  'rar_filter_incomplete_block.rar':
    'UmFyIRoHAM+QcwAADQAAAAAAAABNYXQgkC4AfwAAABAnAAADnowHE+CwNF0dNQkAtIEAAGYyNTAwLmJpbgDwGr8wAL+IX9rp/7th' +
    '0ACJwACQjpeAzSDAdhOkF4S7Nun1IK2sonQLrnC2SKYnH7uABOcY/wD9CuYWSNfiBzICSRcWCAt6ZJFF02i62JHhxtEru+RdJfCz' +
    'dHilQWVIVbHhKUf2DTBRM3NmjMPOvSgs5gmAUsMJpXJiYgAAv4hn9qn/1MQ9ewBABwA=',
  'rar5_extra_field_version.rar':
    'UmFyIRoHAQAzkrXlCgEFBgAFAQGAgACiun1UIQIDBFkGX+2DApfaN1y3gUHygAMBCGJpbi8ydG8zAwQAAcXJViVVQj91BD35RTGa' +
    'V0qEdEp6IKTAj8DmQFv8JEJKg947yrO6OnKo10b2VmvGba4Pmk3M3AZVpY0FggjakkdC/Y6OZLjxo+pnYB6mQuJqz5SfyI3gSVrA' +
    '1G3JxR4CAtkABt8A7YMCl9o3XLeBQfKAAwEIYmluLzJ0bzPFyVYlVUI/dQQ9+UUxmldKhHRKeiCkwI/A5kBb/CRCSoPeO8qzujpy' +
    'qNdG9lZrxm2uD5pNzNwGVaWNBYII2pJHQv2OjmS48aPqZ2AepkLias+Un8iN4ElawB13VlEDBQQA',
  'rar5_solid_encrypted.rar':
    'UmFyIRoHAQAgtvoRCgEFBgQFAQGAgABhD8WeUgIDPLAABJIAIFVuWu6AQwAFYS50eHQwAQABD4AO+ltBRZAMdjBQiNnLDfQI7VR1' +
    'p9MLvo+08ad28VAv4g84Lifed3gQH70kCgMCfCGEo4J82gE1pZSt+eqf2NsfSgASsQSTg/Dfo8jerfnnk0KSXvAe89E8IU+RSz6h' +
    'kSnpWpIfguz8l01nUgIDPJAABJIAID37tWPAQwAFYi50eHQwAQADD4AO+ltBRZAMdjBQiNnLDfQZHnb1t0VBULbYAW3tdK7f4g84' +
    'Lifed3gQH70kCgMCcmWYpoJ82gEjM46yUVAy4KNVZG4T5HLJHXwcClICAzyQAASSACD/J5yGwEMABWMudHh0MAEAAw+ADvpbQUWQ' +
    'DHYwUIjZyw30W2TcRNmMRpQCQNayPVdi1uIPOC4n3nd4EB+9JAoDAj5I6a6CfNoBiihfqHObfXFsRShGQFWdAkeP7D9SAgM8kAAE' +
    'kgAgexd0w8BDAAVkLnR4dDABAAMPgA76W0FFkAx2MFCI2csN9GlzaIL1Pzt2pDbf1ZaghGviDzguJ953eBAfvSQKAwJ7xSn0j3za' +
    'ATngcETEsrz5jjXk4OrZA7Add1ZRAwUEAA==',
  'zip_encryption_data.zip':
    'UEsDBDMAQQAAAK1pMUPoKpmhVgEAABQAAAAHAAAAYmFyLnR4dBAASDPwpxm0KmEU1KEDsY7NfiABAAADABBmAAEBAJAA7zsPqbDC' +
    'Lq2DN4+/cnUs6ZuQNCT0f1ztClUxWf7BOTzE+y4e2XyfIPupuy+JK6gNc3lc8WoJFMeALwtLnH/PnMgdvxpe08KpCXmko+7LPI7P' +
    'zTIzdSqy+iR20Xu2d8w1Kps6IzNZwgDreo0rcZE4nfTeJax1o0U+Xq5Kbi/4OMWmjziQ9NbrNaB3C8ZDXFq0AAAAAIAApetTuFy3' +
    'ro0THo2L2XH8znKJMV3AXwNCqQR+K4VmNrGbA8m4sFz7BBCqRcquHE8zk2CefUiaJIYGUJjP/+UB0mLAX3AFVSdJ2qZ1fToM3gCZ' +
    'zYQWS0nz5/caO8d4/zjjck9MW7J73LteRfMpBplgdGqTZfr4VLQ585Ab+O7tyg90if3nNOkP9yvuzqIWthsT+++2bJf9IbKlhDFE' +
    '0u9fS1BLAwQzAEEAAACqaTFD/8wGUlYBAAAUAAAABwAAAGZvby50eHQQAIucqpqJZMksUcJ6zaMEtWMgAQAAAwAQZgABAQCQAO87' +
    'D6mwwi6tgzePv3J1LOmbkDQk9H9c7QpVMVn+wTk8xPsuHtl8nyD7qbsviSuoDXN5XPFqCRTHgC8LS5x/z5zIHb8aXtPCqQl5pKPu' +
    'yzyOz80yM3UqsvokdtF7tnfMNSqbOiMzWcIA63qNK3GROJ303iWsdaNFPl6uSm4v+DjFpo84kPTW6zWgdwvGQ1xatAAAAACAACOv' +
    '4RVH/BrOvnh3WLt9jb7nYgSWMmiziGPUWxgD7TQRACVRFjJT7RR/0wDJXv/WAGPmfmnn9nZb3OsECc0OMIWYFm7ZpR60z9eboSG7' +
    'sEwuzDuknZxgimsEAGzfcyrpmEQNO2B7wpqOLCVn3JTsbq3jkezTbMkDvzDF6evWpdtURp+G44Cqs00rs39KidLeIj9LW9oKKDk4' +
    '/lqbZii5bMdQSwECQAAzAEEAAACtaTFD6CqZoVYBAAAUAAAABwA0AAAAAAABACAAAAAAAAAAYmFyLnR4dAoAIAAAAAAAAQAYACOg' +
    'xO2Ws84BI6DE7ZazzgEjoMTtlrPOARcADAACABBmAAEBAAAAAABQSwECQAAzAEEAAACqaTFD/8wGUlYBAAAUAAAABwA0AAAAAAAB' +
    'ACAAAAB7AQAAZm9vLnR4dAoAIAAAAAAAAQAYACUjWOmWs84BJSNY6ZazzgElI1jplrPOARcADAACABBmAAEBAAAAAABQSwUGAAAA' +
    'AAIAAgDSAAAA9gIAAAAA',
  'zip_extra_padding.zip':
    'UEsDBAoAAAAAACNdj03E8sf2AgAAAAIAAAABABwAYQAAAABVVAkAA9JYFVzbWBVcAAAEAAAAAAAAAABiClBLAQIeAwoAAAAAACNd' +
    'j03E8sf2AgAAAAIAAAABABgAAAAAAAEAAACkgQAAAABhAAAAAFVUCQAD0lgVXNtYFVwAAAQAAAAAAEsFBgAAAAABAAEARwAAAD0A' +
    'AAAAAA==',
  'iso_rockridge_cl_re_control.iso.Z':
    'H52QAAIKHEiwoMGDCBMqXMiwocOHECNKnEixosWLGDNq3Mixo8ePIEOKHEmypMmTKFOqXMmypcuXMGPKnEmzps2bOHPq3Mmzp8+f' +
    'QIMKHUq0qNGjSJMqXcq0qdOnUKNKnUq1qtWrWLNq3cq1q9evYMOKHUu2rNmzaNOqXcu2rdu3cOPKnUu3rt27ePPq3cu3r9+/gAML' +
    'Hky4sOHDiBMrXsy4sePHkCNLnky5suXLmDNr3sy5s+fPoEOLHk26tOnTqFOrXs26tevXsGPLnk27tu3buHPr3s27t+/fwIMLH068' +
    'uPHjyJMrX868ufPn0KNLn069uvXr2LNr3869u/fv4MOLH0++vPnz6NOrX8++vfv38OPLn0+/vv37+PPr38+/v/+/AQxBBAwwxBAA' +
    'ACAkqOCCDDbo4IJDPOEEFVI8wUSFQywhRRJEHFHEgw8elEFBI3p0IAABnHggAggAoEBBCkiQ0AQDiQCABQXh2KJALfqRgAEDCRCQ' +
    'iif+ZyRbMsAggw0w5AADkwRGSSAASS7Z5JNSSilSkUd26eWXfP0jIIEGgmnmmWimqeaauR2I45BsxinnnHTWaSdiXOLI5Z189unn' +
    'n4AGKuighBZq6KGIJqrooow26uijfelwY44A7BhQjz8GCSeKB04BxQEB+PIOAFJIUUCKUGDBQADtBDFQEO3Y+OZAOg6EKZACCYni' +
    'kCnCAMAFBQFraaUA+IhrQLqqiIAccnzRxht2lEEGqaamCOm12Gar7bZvofBrsMTyWGymuW5qbamnHigrpcPequmunAZgAgAYFFRv' +
    'u+MeC0CyvAohRREE7MntwAQXbPDBYXlbL0H32prvu0RSmy4ANgJLkLAOGwsxrwGoAJHGBak4QBA7xICutQinrPLKLLfsEw==',
  'iso_3.iso.Z':
    'H52QAAIKHEiwoMGDCBMqXMiwocOHECNKnEixosWLGDNq3Mixo8ePIEOKHEmypMmTKFOqXMmypcuXMGPKnEmzps2bOHPq3Mmzp8+f' +
    'QIMKHUq0qNGjSJMqXcq0qdOnUKNKnUq1qtWrWLNq3cq1q9evYMOKHUu2rNmzaNOqXcu2rdu3cOPKnUu3rt27ePPq3cu3r9+/gAML' +
    'Hky4sOHDiBMrXsy4sePHkCNLnky5suXLmDNr3sy5s+fPoEOLHk26tOnTqFOrXs26tevXsGPLnk27tu3buHPr3s27t+/fwIMLH068' +
    'uPHjyJMrX868ufPn0KNLn069uvXr2LNr3869u/fv4MOLH0++vPnz6NOrX8++vfv38OPLn0+/vv37+PPr38+/v/+/AQxBBAwwxBAA' +
    'AE6UQYcQUxABwoMQRijhhBRWaOGFEB6UQUEbenQgAAF8eCACCADgQUEeSJDQBAMRAQAFBcFYokAllmLjjaUIEJCIB2Lo449ABink' +
    'kEQWaeSRSCap5JJMNunkk1BGKeWUVFZppY8yFBgDDDjEQIMMMWxJwwwEkpNlmFx6CaaYZMJADoFwxiknnGdu2eWXaI5Z5of/9enn' +
    'n4X9IyCBBgJq6KGIJqrooscdCOOOAh1YQaQABAEiABdQOgSjnHbq6aeghgoYny9eampAkwZgKamZBijqq7DGKuustD4lQqkEyThQ' +
    'jTjaqKOpIQJw66MD6UojAL36CimIId46KUGTzhhQiW8g4EAFChhAzq88BnFrpgRlKi0A1FqL7QLbLhviprW26+678MYbnbMFRbsr' +
    'ANVem226wB44bIzk3ptsjuqGaAIAFhRkgQEFGZAvttpSCiIBQriwQwzyZqzxxhx33BwaZbDBxhsKeGzyySinrHKn3xYk7r0PK4Au' +
    'tzv6i2uxAR87MM3MBnAwBgVhwDBBDpsrMzkSB0AAERZjvPLTUEct9dSEgSwyyVRnrfXWXHft9ddghy322GSXbfbZaKet9tpst+32' +
    '23DHLffcdNdt991456333nz37fffgAcu+OCEF2744YgnrvjijDfu+OOQRy755JRXbvnlmGeu+eacd+7556CHLvropJdu+umop676' +
    '6qy37vrrsMcu++y012777bjnrvvuvPfu++/ABy/88MQXb/zxyCev/PLMN+/889BHL/301Fdv/fXYZ6/99tx37/334Icv/vjkl2/+' +
    '+einr/767Lfv/vvwxy///PTXb//9+Oev//789+///wAMoAAHSMACGvCACEygAhfIwAY68IEQjKAEJ0jBClrwghjMoAY3yMEOevCD' +
    'IAyhCEdIwhKa8IQoTKEKV8jCFrrwhTCMoQxnSMMa2vCGOMyhDnfIwx768IdADKIQh0jEIhrxiEhMohKXyMQmOvGJUIyiFKdIxSpa' +
    '8YpYzKIWt8jFLnrxi2AMoxjHSMYymvGMaEyjGtfIxja68Y1wjKMc50jHOtrxjnjMox73yMc++vGPgAykIAdJyEIa8pCITKQiF8nI' +
    'RjrykZCMpCQnSclKWvKSmMykJjfJyU568pOgDKUoR0nKUprylKhMpSpXycpWuvKVsIylLGdJy1ra8pa4zKUud8nLXvryl8AMpjCH' +
    'ScxiGvOYyEymMpfJzGY685nQjKY0p0nNalrzmtjMpja3yc1uevOb4AynOMdJznKa85zoTKc618nOdrrznfCMpzznSc962vOe+Myn' +
    'PvfJz376858ADahAB0rQghr0oAhNqEIXytCGOvShEI2oRCdK0Ypa9KIYzahGN8rRjnr0oyANqUhHStKSmvSkKE2pSlfK0pa69KUw' +
    'jalMZ0rTmtr0pjjNqU53ytOe+vSnQA2qUIdK1KIa9ahITapSl8rUpjr1qVCNqlSnStWqWvWqWM2qVrfK1a569atgDatYx0rWspr1' +
    'rGhNq1rXyta2uvWtcI2rOAE=',
};

const te = new TextEncoder(), td = new TextDecoder();
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const unZ = (b) => readAll(lzwStream(new Reader(sourceStream(bytesSource(b), 2))));
const fixture = (name) => { const b = b64(FIXTURES[name]); return bytesSource(name.endsWith('.Z') ? unZ(b) : b, name.replace(/\.Z$/, '')); };
const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code || String(e); } };
const text = (arc, e) => td.decode(readAll(arc.open(e)));

// --- ZIP builder for the scan tests (stored entries; data descriptors with or without their signature) ---------
// Data descriptors with and without their optional signature (PK): both occur in the wild, and a scanner
// that only knows one form misreads streamed ZIPs written by the other.
function zipBuild(files, { descriptor = false, sigDescriptor = true, central = true } = {}) {
  const parts = [], cd = [];
  let off = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = te.encode(f.name), data = typeof f.data === 'string' ? te.encode(f.data) : f.data;
    const crc = crc32(data), flags = 0x800 | (descriptor ? 8 : 0);
    const sizes = descriptor ? [...u32(0), ...u32(0), ...u32(0)] : [...u32(crc), ...u32(data.length), ...u32(data.length)];
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(0), ...u16(0), ...u16(0x21), ...sizes, ...u16(name.length), ...u16(0), ...name]);
    const desc = descriptor ? Uint8Array.from([...(sigDescriptor ? u32(0x08074b50) : []), ...u32(crc), ...u32(data.length), ...u32(data.length)]) : new Uint8Array(0);
    cd.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...name]));
    parts.push(local, data, desc);
    off += local.length + data.length + desc.length;
  }
  if (central) {
    const cdLen = cd.reduce((n, c) => n + c.length, 0);
    parts.push(...cd, Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdLen), ...u32(off), ...u16(0)]));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

export async function run() {
  let pass = 0, fail = 0;
  const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ': ' + detail : '')); } };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
  const guard = (name, fn) => { try { fn(); } catch (e) { ok(name, false, (e.code || '') + ' ' + e.message); } };

  // RAR 2.9 LZ: a low distance after a table reset (libarchive test_read_format_rar3_lowdist_reset).
  guard('rar3 lowdist', () => {
    const arc = openArchive([fixture('rar3_lowdist_reset.rar')]);
    const want = [...Array(40).keys(), 2, 3, 4, 5, 6, 7, 13, 14, 15, ...Array.from({ length: 15 }, (_, i) => 0x28 + i)];
    eq('rar3 lowdist listing', arc.entries.map((e) => [e.path, e.size, e.method]), [['lowdist-reset.bin', 64, 'RAR 2.9 m5']]);
    eq('rar3 lowdist data', [...readAll(arc.open(arc.entries[0]))], want);
  });

  // RAR 2.9 PPMd block followed by LZ with a DELTA filter; the file's CRC-32 verifies (7-Zip agrees).
  guard('rar ppmd delta', () => {
    const arc = openArchive([fixture('rar_filter_incomplete_block.rar')]);
    const b = readAll(arc.open(arc.entries[0]));
    ok('rar ppmd delta', arc.entries[0].path === 'f2500.bin' && b.length === 10000 && crc32(b) === arc.entries[0].crc);
  });

  // RAR 3.x AES-128: a.txt / c.txt plain, b.txt with "password", d.txt with "password2" (test_read_format_rar_encryption.c).
  guard('rar4 encrypted', () => {
    const arc = openArchive([fixture('rar4_encrypted.rar')]);
    eq('rar4 encrypted listing', arc.entries.map((e) => [e.path, e.size, !!e.encrypted]), [['a.txt', 18, false], ['b.txt', 18, true], ['c.txt', 18, false], ['d.txt', 18, true]]);
    eq('rar4 plain without password', text(arc, arc.entries[0]), 'This is from a.txt');
    eq('rar4 no password', code(() => readAll(arc.open(arc.entries[1]))), 'password');
    arc.password = 'password';
    eq('rar4 b.txt', text(arc, arc.entries[1]), 'This is from b.txt');
    eq('rar4 d.txt wrong password', code(() => readAll(arc.open(arc.entries[3]))), 'badPassword');
    // A failed file must not spoil the next one (the decoder is reset, not continued).
    arc.password = 'password2';
    eq('rar4 b.txt with password2', code(() => readAll(arc.open(arc.entries[1]))), 'badPassword');
    eq('rar4 d.txt after a failure', text(arc, arc.entries[3]), 'This is from d.txt');
    eq('rar4 c.txt', text(arc, arc.entries[2]), 'This is from c.txt');
  });
  guard('rar4 solid encrypted', () => {
    const arc = openArchive([fixture('rar4_solid_encrypted.rar')], { password: 'password' });
    ok('rar4 solid flag', arc.info.solid === true);
    eq('rar4 solid all', arc.entries.map((e) => text(arc, e)), ['a', 'b', 'c', 'd'].map((x) => `This is from ${x}.txt`));
    eq('rar4 solid backwards', text(arc, arc.entries[1]), 'This is from b.txt');
  });
  guard('rar4 encrypted names', () => {
    eq('rar4 headers need a password', code(() => openArchive([fixture('rar4_encrypted_filenames.rar')])), 'password');
    eq('rar4 headers wrong password', code(() => openArchive([fixture('rar4_encrypted_filenames.rar')], { password: 'nope' })), 'badPassword');
    const arc = openArchive([fixture('rar4_encrypted_filenames.rar')], { password: 'password' });
    ok('rar4 headers flag', arc.info.headersEncrypted === true);
    eq('rar4 headers data', arc.entries.map((e) => [e.path, text(arc, e)]), ['a', 'b', 'c', 'd'].map((x) => [x + '.txt', `This is from ${x}.txt`]));
  });

  // RAR 5: older file versions (rar -ver) become name;N; both carry CRC 0xF24181B7.
  guard('rar5 versions', () => {
    const arc = openArchive([fixture('rar5_extra_field_version.rar')]);
    eq('rar5 version names', arc.entries.map((e) => e.path), ['bin/2to3;1', 'bin/2to3']);
    for (const e of arc.entries) ok('rar5 version crc ' + e.path, crc32(readAll(arc.open(e))) === 0xf24181b7);
  });
  guard('rar5 solid encrypted', () => {
    const arc = openArchive([fixture('rar5_solid_encrypted.rar')]);
    eq('rar5 solid needs a password', code(() => readAll(arc.open(arc.entries[0]))), 'password');
    arc.password = 'wrong';
    eq('rar5 solid wrong password', code(() => readAll(arc.open(arc.entries[0]))), 'badPassword');
    arc.password = 'password';
    eq('rar5 solid all', arc.entries.map((e) => text(arc, e)), ['a', 'b', 'c', 'd'].map((x) => `This is from ${x}.txt`));
  });

  // PKWARE strong encryption, AES-256 (test_read_format_zip_encryption_data: password "12345678").
  guard('zip strong', () => {
    const arc = openArchive([fixture('zip_encryption_data.zip')]);
    eq('zip strong listing', arc.entries.map((e) => [e.path, e.size, e.method, !!e.encrypted, e.unsupported]),
      [['bar.txt', 20, 'Stored AES-256 (PKWARE)', true, undefined], ['foo.txt', 20, 'Stored AES-256 (PKWARE)', true, undefined]]);
    eq('zip strong no password', code(() => readAll(arc.open(arc.entries[0]))), 'password');
    arc.password = '1234567';
    eq('zip strong wrong password', code(() => readAll(arc.open(arc.entries[0]))), 'badPassword');
    arc.password = '12345678';
    eq('zip strong data', arc.entries.map((e) => text(arc, e)), ['"data of bar.txt" \r\n', '"data of foo.txt" \r\n']);
  });

  // No valid end of central directory: the local headers are scanned (test_read_format_zip_extra_padding).
  guard('zip extra padding', () => {
    const arc = openArchive([fixture('zip_extra_padding.zip')]);
    eq('zip scan listing', arc.entries.map((e) => [e.path, e.size, e.mtime.getTime() / 1000]), [['a', 2, 0x5c1558d2]]);
    eq('zip scan data', text(arc, arc.entries[0]), 'b\n');
    ok('zip scan warning', arc.info.warnings.length === 1);
  });

  // Local header scan of archives built here: sizes in the headers, descriptors with and without signature, cut-offs.
  const files = [{ name: 'one.txt', data: 'first file' }, { name: 'dir/', data: '' }, { name: 'dir/two.bin', data: Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) & 255) }, { name: 'three.txt', data: 'PK\x07\x08 inside the data' }];
  for (const [label, o] of [['sizes', {}], ['descriptor', { descriptor: true }], ['bare descriptor', { descriptor: true, sigDescriptor: false }]]) {
    guard('zip scan ' + label, () => {
      const whole = zipBuild(files, o), noCd = zipBuild(files, { ...o, central: false });
      const a = openArchive([bytesSource(whole, 'a.zip')]), b = openArchive([bytesSource(noCd, 'b.zip')]);
      eq('zip scan ' + label + ' paths', b.entries.map((e) => [e.path, e.dir, e.size]), a.entries.map((e) => [e.path, e.dir, e.size]));
      ok('zip scan ' + label + ' data', b.entries.every((e, i) => e.dir || readAll(b.open(e)).join() === readAll(a.open(a.entries[i])).join()));
      ok('zip scan ' + label + ' warned', !a.info.warnings.length && b.info.warnings.length === 1);
      // Cut inside the last file: the others are fine, the last one fails its checks.
      const cut = openArchive([bytesSource(noCd.subarray(0, noCd.length - (o.descriptor ? 20 : 8)), 'c.zip')]);
      eq('zip scan ' + label + ' cut count', cut.entries.length, 4);
      ok('zip scan ' + label + ' cut first', text(cut, cut.entries[0]) === 'first file');
      ok('zip scan ' + label + ' cut last fails', code(() => readAll(cut.open(cut.entries[3]))) !== 'ok');
      ok('zip scan ' + label + ' truncated warning', /truncated/.test(cut.info.warnings[0] || ''));
    });
  }
  eq('zip scan nothing', code(() => openArchive([bytesSource(te.encode('PK\x03\x04 not really a zip'), 'x.zip')])), 'format');
  eq('zip scan function', scanLocalHeaders(bytesSource(zipBuild(files, { central: false }))).entries.map((z) => z.name), files.map((f) => f.name));

  // ISO 9660: a 68-byte root record in the volume descriptor (test_read_format_iso_3).
  guard('iso 68-byte root', () => {
    const arc = openArchive([fixture('iso_3.iso.Z')]);
    eq('iso 68-byte root listing', arc.entries.map((e) => [e.path, e.dir]), [['A', true], ['A/B', false], ['C', true], ['C/D', false]]);
    eq('iso 68-byte root data', text(arc, arc.entries[1]), 'hello\n');
  });
  // Rock Ridge: a relocated (RE) directory that no child link (CL) points to stays in rr_moved.
  guard('iso relocation without a link', () => {
    const arc = openArchive([fixture('iso_rockridge_cl_re_control.iso.Z')]);
    eq('iso relocation listing', arc.entries.map((e) => [e.path, e.dir]), [['rr_moved', true], ['rr_moved/B', true], ['rr_moved/B/A', false]]);
  });

  console.log(`archive libarchive fixtures: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
