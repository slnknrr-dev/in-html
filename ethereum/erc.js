// ethereum/erc.js - token standards: human-readable ABIs of ERC-20, ERC-721, ERC-1155 and WETH9, call data of the
// usual transfers, ERC-165 interface ids, the token transfer a transaction's call data asks for.
//
//   ERC20_ABI, ERC721_ABI, ERC1155_ABI, WETH_ABI, ERC165_ABI    (arrays of human-readable lines, events included)
//   erc20TransferData(to, amount), erc20ApproveData(spender, amount), erc20TransferFromData(from, to, amount),
//   erc20BalanceOfData(owner), erc20AllowanceData(owner, spender)                                   -> '0x…'
//   erc721SafeTransferData(from, to, tokenId, data = null), erc721TransferFromData(from, to, tokenId),
//   erc721OwnerOfData(tokenId), erc1155SafeTransferData(from, to, id, amount, data = '0x'),
//   erc1155SafeBatchTransferData(from, to, ids, amounts, data = '0x'), erc1155BalanceOfData(owner, id),
//   setApprovalForAllData(operator, approved), supportsInterfaceData(interfaceId)                    -> '0x…'
//   interfaceId(signatures) -> '0x12345678'  (XOR of the selectors, ERC-165)
//   INTERFACE_IDS: { erc165, erc721, erc721Metadata, erc721Enumerable, erc721Receiver, erc1155,
//                    erc1155MetadataURI, erc1155Receiver, erc2981, erc4906 }
//   decodeTokenTransfer(data) -> { standard, method, from?, to, amount?, tokenId?, data? } | null
//       erc20 transfer / transferFrom, erc721 safeTransferFrom (with or without data), erc1155 safeTransferFrom /
//       safeBatchTransferFrom (ids, amounts). transferFrom(address,address,uint256) has the same selector in
//       ERC-20 and ERC-721: it reports standard 'erc20' with `ambiguous: 'erc721'` and the value as amount and tokenId.
import { decodeFunctionData, encodeFunctionData, functionSelector, parseAbi } from './abi.js';

export const ERC20_ABI = Object.freeze([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]);

export const ERC165_ABI = Object.freeze(['function supportsInterface(bytes4 interfaceId) view returns (bool)']);

export const ERC721_ABI = Object.freeze([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data) payable',
  'function safeTransferFrom(address from, address to, uint256 tokenId) payable',
  'function transferFrom(address from, address to, uint256 tokenId) payable',
  'function approve(address approved, uint256 tokenId) payable',
  'function setApprovalForAll(address operator, bool approved)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  ...ERC165_ABI,
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
  'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
]);

export const ERC1155_ABI = Object.freeze([
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
  'function uri(uint256 id) view returns (string)',
  ...ERC165_ABI,
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
  'event ApprovalForAll(address indexed account, address indexed operator, bool approved)',
  'event URI(string value, uint256 indexed id)',
]);

export const WETH_ABI = Object.freeze([
  ...ERC20_ABI,
  'function deposit() payable',
  'function withdraw(uint256 wad)',
  'event Deposit(address indexed dst, uint256 wad)',
  'event Withdrawal(address indexed src, uint256 wad)',
]);

// ERC-165: the XOR of the selectors of an interface's functions.
// ERC-165: XOR of the 4-byte selectors. JS bitwise ops work on int32, so the result may be negative; >>> 0 converts it
// back to an unsigned 32-bit value before hex formatting. XOR makes the id order-independent but also means two
// interfaces with the same function set (or functions cancelling out) share an id.
export function interfaceId(signatures) {
  let x = 0;
  for (const s of signatures) x ^= parseInt(functionSelector(s).slice(2), 16);
  return '0x' + (x >>> 0).toString(16).padStart(8, '0');
}

// Constants, not computed: they are fixed by the standards and the tests recompute them with interfaceId().
export const INTERFACE_IDS = Object.freeze({
  erc165: '0x01ffc9a7',
  erc721: '0x80ac58cd',
  erc721Metadata: '0x5b5e139f',
  erc721Enumerable: '0x780e9d63',
  erc721Receiver: '0x150b7a02',
  erc1155: '0xd9b67a26',
  erc1155MetadataURI: '0x0e89341c',
  erc1155Receiver: '0x4e2312e0',
  erc2981: '0x2a55205a',
  erc4906: '0x49064906',
});

const call = (sig, args) => encodeFunctionData(sig, args);

export const erc20TransferData = (to, amount) => call('transfer(address,uint256)', [to, amount]);
export const erc20ApproveData = (spender, amount) => call('approve(address,uint256)', [spender, amount]);
export const erc20TransferFromData = (from, to, amount) => call('transferFrom(address,address,uint256)', [from, to, amount]);
export const erc20BalanceOfData = (owner) => call('balanceOf(address)', [owner]);
export const erc20AllowanceData = (owner, spender) => call('allowance(address,address)', [owner, spender]);
export const erc721SafeTransferData = (from, to, tokenId, data = null) =>
  data == null ? call('safeTransferFrom(address,address,uint256)', [from, to, tokenId]) : call('safeTransferFrom(address,address,uint256,bytes)', [from, to, tokenId, data]);
export const erc721TransferFromData = (from, to, tokenId) => call('transferFrom(address,address,uint256)', [from, to, tokenId]);
export const erc721OwnerOfData = (tokenId) => call('ownerOf(uint256)', [tokenId]);
export const erc1155SafeTransferData = (from, to, id, amount, data = '0x') => call('safeTransferFrom(address,address,uint256,uint256,bytes)', [from, to, id, amount, data]);
export const erc1155SafeBatchTransferData = (from, to, ids, amounts, data = '0x') => call('safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', [from, to, ids, amounts, data]);
export const erc1155BalanceOfData = (owner, id) => call('balanceOf(address,uint256)', [owner, id]);
export const setApprovalForAllData = (operator, approved) => call('setApprovalForAll(address,bool)', [operator, approved]);
export const supportsInterfaceData = (id) => call('supportsInterface(bytes4)', [id]);

// Lazily parsed (||=): parsing costs keccak per fragment, and most importers of erc.js never decode a transfer.
let TRANSFERS = null;
const transfers = () => (TRANSFERS ||= parseAbi([
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
]));

export function decodeTokenTransfer(data) {
  let d;
  try { d = decodeFunctionData(transfers(), data); } catch { return null; }
  if (!d) return null;
  const a = d.args;
  switch (d.signature) {
    case 'transfer(address,uint256)': return { standard: 'erc20', method: 'transfer', to: a.to, amount: a.amount };
    // Same selector 0x23b872dd in ERC-20 and ERC-721: call data alone cannot tell them apart (the contract can, via
    // ERC-165). Reported as erc20 with an `ambiguous` hint rather than guessing.
    case 'transferFrom(address,address,uint256)': return { standard: 'erc20', ambiguous: 'erc721', method: 'transferFrom', from: a.from, to: a.to, amount: a.amount, tokenId: a.amount };
    case 'safeTransferFrom(address,address,uint256)': return { standard: 'erc721', method: 'safeTransferFrom', from: a.from, to: a.to, tokenId: a.tokenId };
    case 'safeTransferFrom(address,address,uint256,bytes)': return { standard: 'erc721', method: 'safeTransferFrom', from: a.from, to: a.to, tokenId: a.tokenId, data: a.data };
    case 'safeTransferFrom(address,address,uint256,uint256,bytes)': return { standard: 'erc1155', method: 'safeTransferFrom', from: a.from, to: a.to, tokenId: a.id, amount: a.amount, data: a.data };
    case 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)': return { standard: 'erc1155', method: 'safeBatchTransferFrom', from: a.from, to: a.to, tokenIds: [...a.ids], amounts: [...a.amounts], data: a.data };
    default: return null;
  }
}
