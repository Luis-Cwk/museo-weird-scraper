import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

/**
 * MUSEO WEIRD — Pinata IPFS Service
 *
 * Uploads files (SVG artworks, JSON metadata) to IPFS via Pinata.
 * Adapted from videodanza-nft/backend/services/pinataService.js but using
 * native fetch + Blob instead of form-data, so we don't need extra deps.
 *
 * Methods:
 *   uploadFile(filePath, metadata) → CID
 *   uploadJSON(jsonObject, name, metadata) → CID
 *   getGatewayUrl(cid) / getIpfsUrl(cid) — URL helpers
 *   loadLookupTable() / saveLookupTable() — local CID index
 */

const PINATA_API_URL = "https://api.pinata.cloud";
const DEFAULT_GATEWAY = "https://gateway.pinata.cloud";

export interface PinMetadata {
  name: string;
  keyvalues?: Record<string, string>;
}

export interface UploadResult {
  cid: string;
  ipfsUri: string;
  gatewayUrl: string;
  size?: number;
  filename?: string;
}

export interface LookupEntry {
  cid: string;
  ipfsUri: string;
  gatewayUrl: string;
  uploadedAt: string;
  filename?: string;
  metadataRef?: string;
}

export interface LookupTable {
  contractAddress?: string;
  artworks: Record<string, LookupEntry>;
  metadata: Record<string, LookupEntry>;
  updatedAt: string;
}

const LOOKUP_PATH = path.join(__dirname, "..", "data", "ipfs_lookup_table.json");

export class PinataService {
  private apiKey: string;
  private apiSecret: string;
  private gateway: string;

  constructor() {
    this.apiKey = process.env.PINATA_API_KEY || "";
    this.apiSecret = process.env.PINATA_SECRET_KEY || "";
    this.gateway = process.env.PINATA_GATEWAY_URL || DEFAULT_GATEWAY;

    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Pinata API credentials not configured in .env");
    }
  }

  private get headers(): Record<string, string> {
    return {
      pinata_api_key: this.apiKey,
      pinata_secret_api_key: this.apiSecret,
    };
  }

  /**
   * Upload a file from disk to IPFS.
   */
  async uploadFile(filePath: string, metadata: PinMetadata): Promise<UploadResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const blob = new Blob([fileBuffer]);
    const form = new FormData();
    form.append("file", blob, filename);

    const pinataMetadata = {
      name: metadata.name || filename,
      keyvalues: {
        app: "museo-weird",
        timestamp: new Date().toISOString(),
        ...metadata.keyvalues,
      },
    };
    form.append("pinataMetadata", JSON.stringify(pinataMetadata));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const res = await fetch(`${PINATA_API_URL}/pinning/pinFileToIPFS`, {
      method: "POST",
      headers: this.headers,
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Pinata file upload failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as { IpfsHash: string; PinSize?: number };
    return this.toResult(data.IpfsHash, data.PinSize, filename);
  }

  /**
   * Upload a JSON object directly to IPFS.
   */
  async uploadJSON(
    json: Record<string, any>,
    name: string,
    metadata: PinMetadata = { name }
  ): Promise<UploadResult> {
    const pinataMetadata = {
      name: metadata.name || name,
      keyvalues: {
        app: "museo-weird",
        type: "metadata",
        timestamp: new Date().toISOString(),
        ...metadata.keyvalues,
      },
    };

    const body = {
      pinataContent: json,
      pinataMetadata,
      pinataOptions: { cidVersion: 1 },
    };

    const res = await fetch(`${PINATA_API_URL}/pinning/pinJSONToIPFS`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Pinata JSON upload failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as { IpfsHash: string; PinSize?: number };
    return this.toResult(data.IpfsHash, data.PinSize, name);
  }

  private toResult(cid: string, size?: number, filename?: string): UploadResult {
    return {
      cid,
      ipfsUri: `ipfs://${cid}`,
      gatewayUrl: `${this.gateway}/ipfs/${cid}`,
      size,
      filename,
    };
  }

  getGatewayUrl(cid: string): string {
    return `${this.gateway}/ipfs/${cid}`;
  }

  getIpfsUrl(cid: string): string {
    return `ipfs://${cid}`;
  }

  loadLookupTable(): LookupTable {
    if (!fs.existsSync(LOOKUP_PATH)) {
      return { artworks: {}, metadata: {}, updatedAt: new Date().toISOString() };
    }
    return JSON.parse(fs.readFileSync(LOOKUP_PATH, "utf-8"));
  }

  saveLookupTable(table: LookupTable) {
    table.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(LOOKUP_PATH), { recursive: true });
    fs.writeFileSync(LOOKUP_PATH, JSON.stringify(table, null, 2));
  }

  recordArtwork(id: string, result: UploadResult, metadataRef?: string) {
    const table = this.loadLookupTable();
    table.artworks[id] = {
      ...result,
      uploadedAt: new Date().toISOString(),
      metadataRef,
    };
    this.saveLookupTable(table);
  }

  recordMetadata(id: string, result: UploadResult) {
    const table = this.loadLookupTable();
    table.metadata[id] = {
      ...result,
      uploadedAt: new Date().toISOString(),
    };
    this.saveLookupTable(table);
  }
}

// --- Self-test ---
if (require.main === module) {
  (async () => {
    try {
      const service = new PinataService();
      console.log("Pinata service initialized\n");

      // Quick connectivity test: upload a tiny JSON
      const result = await service.uploadJSON(
        { test: "museo-weird connectivity check", timestamp: new Date().toISOString() },
        "connectivity-test.json"
      );
      console.log(`✓ Test upload successful`);
      console.log(`  CID:         ${result.cid}`);
      console.log(`  IPFS URI:    ${result.ipfsUri}`);
      console.log(`  Gateway URL: ${result.gatewayUrl}`);
    } catch (err: any) {
      console.error(`✗ ${err.message}`);
      process.exitCode = 1;
    }
  })();
}