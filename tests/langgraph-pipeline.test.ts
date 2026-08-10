import fs from "fs";
import os from "os";
import path from "path";
import { AgentState, buildGraph } from "../scripts/langgraph-pipeline";
import { chatText } from "../scripts/llm-client";

const loginMock = jest.fn();
const searchPostsMock = jest.fn();
const chatTextMock = chatText as jest.Mock;

jest.mock("@atproto/api", () => ({
  BskyAgent: jest.fn().mockImplementation(() => ({
    login: loginMock,
    app: { bsky: { feed: { searchPosts: searchPostsMock } } },
  })),
}));

jest.mock("../scripts/llm-client", () => ({
  chatText: jest.fn(),
}));

const baseState: AgentState = {
  rawPosts: [],
  currentIndex: 0,
  currentPost: null,
  candidateText: "",
  sanitizedText: "",
  validatedText: "",
  contentType: "fact",
  contentCategory: "other",
  sanitizer: { status: "pending" },
  verifier: { status: "pending" },
  svg: null,
  errors: [],
};

const buildPost = (text: string) => ({
  uri: "at://did:plc:test/app.bsky.feed.post/1",
  cid: "cid1",
  record: { text, createdAt: "2024-01-01T00:00:00.000Z" },
  author: { did: "did:plc:test", handle: "tester.bsky.social" },
  likeCount: 1,
  replyCount: 0,
  repostCount: 0,
});

let outputDir = "";

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BLUESKY_HANDLE = "tester.bsky.social";
  process.env.BLUESKY_APP_PASSWORD = "app-pass";
  process.env.BLUESKY_SERVICE_URL = "https://bsky.social";
  process.env.BLUESKY_SEARCH_TERMS = "museo";
  process.env.BLUESKY_SEARCH_LIMIT = "5";
  process.env.NVIDIA_API_KEY = "nvidia-key";
  process.env.NVIDIA_MODEL = "meta/llama-3.1-70b-instruct";
  outputDir = path.join(os.tmpdir(), "museo-weird-tests");
  process.env.SVG_OUTPUT_DIR = outputDir;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
});

afterEach(() => {
  if (!outputDir || !fs.existsSync(outputDir)) return;
  for (const file of fs.readdirSync(outputDir)) {
    fs.unlinkSync(path.join(outputDir, file));
  }
});

test("approves content and generates SVG", async () => {
  searchPostsMock.mockResolvedValue({
    data: { posts: [buildPost("Museo abandonado con piezas sin registro oficial.")] },
  });
  chatTextMock.mockResolvedValue(JSON.stringify({
    approved: true,
    reason: "On-topic and surreal.",
    category: "surreal",
    type: "fact",
  }));

  const graph = buildGraph();
  const result = await graph.invoke({ ...baseState });

  expect(result.sanitizer.status).toBe("passed");
  expect(result.verifier.status).toBe("passed");
  expect(result.svg?.svg).toContain("MUSEO WEIRD");
  expect(result.svg?.path).toBeTruthy();
  expect(result.contentCategory).toBe("surreal");
  expect(result.contentType).toBe("fact");
});

test("rejects content when NVIDIA verifier denies", async () => {
  searchPostsMock.mockResolvedValue({
    data: { posts: [buildPost("Museo con relatos extranos sobre piezas saqueadas.")] },
  });
  chatTextMock.mockResolvedValue(JSON.stringify({
    approved: false,
    reason: "Off-topic or low impact.",
    category: "other",
    type: "fact",
  }));

  const graph = buildGraph();
  const result = await graph.invoke({ ...baseState });

  expect(result.sanitizer.status).toBe("passed");
  expect(result.verifier.status).toBe("rejected");
  expect(result.svg).toBeNull();
});

test("rejects content when sanitizer fails", async () => {
  searchPostsMock.mockResolvedValue({
    data: { posts: [buildPost("Visita http://example.com ahora mismo.")] },
  });
  chatTextMock.mockResolvedValue(JSON.stringify({
    approved: true,
    reason: "Should not run.",
    category: "surreal",
    type: "fact",
  }));

  const graph = buildGraph();
  const result = await graph.invoke({ ...baseState });

  expect(result.sanitizer.status).toBe("rejected");
  expect(chatTextMock).not.toHaveBeenCalled();
  expect(result.svg).toBeNull();
});
