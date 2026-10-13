import test from "node:test";
import assert from "node:assert/strict";
import { filePath, FileAccessError, MAX_AVATAR_BYTES, MAX_FILE_BYTES } from "../lib/appStorageShared";

const OWNER = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
let backend = "neondb";
let cookieToken = "valid-owner";
let blobCalls: Array<{ method: string; path?: unknown; options?: any }> = [];
let tokenOptions: any = null;
let blobContentType = "application/pdf";
const fakeBlob = {
  async put(path: string, _body: unknown, options: any) { blobCalls.push({ method: "put", path, options }); return { pathname: path }; },
  async copy(path: string, to: string, options: any) { blobCalls.push({ method: "copy", path: [path, to], options }); return { pathname: to }; },
  async del(path: unknown) { blobCalls.push({ method: "del", path }); },
  async get(path: string, options: any) {
    blobCalls.push({ method: "get", path, options });
    return { statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("file")); controller.close(); } }), blob: { contentType: blobContentType, size: 4 } };
  },
  async list(options: any) { blobCalls.push({ method: "list", options }); return { blobs: [], hasMore: false }; },
  async issueSignedToken(options: any) { blobCalls.push({ method: "issueSignedToken", options }); return { delegationToken: "secret-delegation", clientSigningToken: "secret-signing-key", validUntil: options.validUntil }; },
  async presignUrl(_token: any, options: any) { blobCalls.push({ method: "presignUrl", options }); return { presignedUrl: "https://private.example.test/scoped-signed-file" }; },
};
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (id: string, ...args: any[]) {
  if (id === "@vercel/blob") return fakeBlob;
  if (id === "@vercel/blob/client") return {
    async upload(path: string, _body: unknown, options: any) {
      blobCalls.push({ method: "clientUpload", path, options }); return { pathname: path };
    },
    async handleUpload(options: any) {
      tokenOptions = await options.onBeforeGenerateToken(options.body.payload.pathname, options.body.payload.clientPayload, options.body.payload.multipart);
      blobCalls.push({ method: "handleUpload", options: tokenOptions });
      return { type: "blob.generate-client-token", clientToken: "limited-client-token" };
    },
  };
  if (id === "./dataBackend") return { get DATA_BACKEND() { return backend; }, requireNeonDataApiUrl: () => "https://data.example.test/rest/v1" };
  if (id === "./neonAuthToken") return { verifyNeonToken: async (token: string) => {
    if (token !== "valid-owner") throw new Error("Rejected JWT with provider detail: secret");
    return { id: OWNER };
  } };
  if (id === "./neonAuthServer") return { getNeonAuthServer: () => ({ token: async () => ({ data: { token: cookieToken }, error: null }) }) };
  return originalLoad.call(this, id, ...args);
};
let service: typeof import("../lib/privateFileService");
let serverStorage: typeof import("../lib/appStorageServer");
let browserStorage: typeof import("../lib/appStorage");
let uploadPOST: (request: Request) => Promise<Response>;
let operationsPOST: (request: Request) => Promise<Response>;
let readGET: (request: Request) => Promise<Response>;
try {
  service = require("../lib/privateFileService");
  serverStorage = require("../lib/appStorageServer");
  browserStorage = require("../lib/appStorage");
  uploadPOST = require("../app/api/files/upload/route").POST;
  operationsPOST = require("../app/api/files/operations/route").POST;
  readGET = require("../app/api/files/read/route").GET;
} finally { Module._load = originalLoad; }

const context = { token: "valid-owner", userId: OWNER };
function request(route: string, body?: unknown, token: string | null = "valid-owner", headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/files/" + route, { method: body === undefined ? "GET" : "POST", headers: { ...(token === null ? {} : { Authorization: "Bearer " + token }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function mockData(t: any, friendship: unknown[], files: unknown[]) {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (async (input: any, options: any) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.origin, "https://data.example.test");
    assert.equal(options.headers.Authorization, "Bearer valid-owner");
    assert.equal(options.cache, "no-store");
    return Response.json(url.pathname.endsWith("friend_connections") ? friendship : files);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  return calls;
}

test("paths reject traversal, encoded paths, URLs and owner-prefix collisions", () => {
  for (const path of [OWNER, "/" + OWNER + "/a", OWNER + "//a", OWNER + "/../a", OWNER + "/./a", OWNER + "/%2e%2e/a", OWNER + "/%252e/a", OWNER + "\\a", OWNER + "/a?x", OWNER + "/a#x", OWNER + "/a*", OWNER + "/a\n", OWNER + "extra/a", "https://example.test/" + OWNER + "/a"]) {
    assert.throws(() => filePath(path), FileAccessError, path);
  }
  assert.deepEqual(filePath(OWNER + "/folder/file.pdf"), { ownerId: OWNER, path: OWNER + "/folder/file.pdf" });
});

test("owner access needs no friendship read and every Blob operation is private", async t => {
  const calls = mockData(t, [], []); blobCalls = [];
  await service.uploadPrivateFile(context, "study-files", OWNER + "/a.pdf", Buffer.from("file"), { contentType: "application/pdf", upsert: false });
  await service.readPrivateFile(context, "study-files", OWNER + "/a.pdf");
  await service.copyPrivateFile(context, "study-files", OWNER + "/a.pdf", OWNER + "/b.pdf");
  await service.removePrivateFiles(context, "study-files", [OWNER + "/a.pdf"]);
  assert.equal(calls.length, 0);
  for (const call of blobCalls.filter(call => ["put", "get", "copy"].includes(call.method))) assert.equal(call.options.access, "private");
  assert.equal(blobCalls[0].options.addRandomSuffix, false);
  assert.equal(blobCalls[0].options.allowOverwrite, false);
  assert.equal(blobCalls[0].options.maximumSizeInBytes, MAX_FILE_BYTES);
});

test("pending, declined and unrelated friendship rows cannot read another owner", async t => {
  const calls = mockData(t, [{ requester_id: OWNER, addressee_id: FRIEND, status: "pending" }, { requester_id: OWNER, addressee_id: FRIEND, status: "declined" }, { requester_id: OWNER, addressee_id: STRANGER, status: "accepted" }], []);
  blobCalls = [];
  await assert.rejects(service.readPrivateFile(context, "study-files", FRIEND + "/a.pdf"), (error: any) => error.status === 403);
  assert.equal(blobCalls.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("status"), "eq.accepted");
  assert.match(calls[0].searchParams.get("or") || "", new RegExp(OWNER));
});

test("accepted friends cannot read processing, missing or owner-mismatched source files", async t => {
  const friendship = [{ requester_id: OWNER, addressee_id: FRIEND, status: "accepted" }];
  mockData(t, friendship, [{ user_id: FRIEND, file_path: FRIEND + "/a.pdf", processing_status: "processing" }, { user_id: OWNER, file_path: FRIEND + "/a.pdf", processing_status: "ready" }]);
  blobCalls = [];
  await assert.rejects(service.readPrivateFile(context, "study-files", FRIEND + "/a.pdf"), (error: any) => error.status === 403);
  assert.equal(blobCalls.length, 0);
});

test("accepted friends read ready sources and only their associated large-file parts", async t => {
  const manifest = FRIEND + "/folder/a.pdf.rbmanifest.json";
  const calls = mockData(t, [{ requester_id: FRIEND, addressee_id: OWNER, status: "accepted" }], [{ user_id: FRIEND, file_path: manifest, processing_status: "ready" }]);
  blobCalls = [];
  await service.readPrivateFile(context, "study-files", FRIEND + "/folder/a.pdf.rbpart-001");
  assert.equal(calls[1].searchParams.get("file_path"), "eq." + manifest);
  assert.equal(calls[1].searchParams.get("user_id"), "eq." + FRIEND);
  assert.equal(calls[1].searchParams.get("processing_status"), "eq.ready");
  await assert.rejects(service.readPrivateFile(context, "study-files", FRIEND + "/folder/b.pdf.rbpart-001"), (error: any) => error.status === 403);
  assert.equal(blobCalls.length, 1);
});

test("friends never write/delete/list under foreign paths; delete validates the whole batch", async t => {
  const calls = mockData(t, [{ requester_id: OWNER, addressee_id: FRIEND, status: "accepted" }], []); blobCalls = [];
  await assert.rejects(service.uploadPrivateFile(context, "study-files", FRIEND + "/a.pdf", "file"), (error: any) => error.status === 403);
  await assert.rejects(service.removePrivateFiles(context, "study-files", [OWNER + "/a.pdf", FRIEND + "/a.pdf"]), (error: any) => error.status === 403);
  await assert.rejects(service.copyPrivateFile(context, "study-files", OWNER + "/a.pdf", FRIEND + "/copied.pdf"), (error: any) => error.status === 403);
  await assert.rejects(service.listPrivateFiles(context, "study-files", FRIEND), (error: any) => error.status === 403);
  assert.equal(calls.length, 0); assert.equal(blobCalls.length, 0);
});

test("copy reads an accepted friend's registered source into the caller's own path", async t => {
  const source = FRIEND + "/a.pdf";
  mockData(t, [{ requester_id: OWNER, addressee_id: FRIEND, status: "accepted" }], [{ user_id: FRIEND, file_path: source, processing_status: "ready" }]); blobCalls = [];
  await service.copyPrivateFile(context, "study-files", source, OWNER + "/copy.pdf");
  assert.deepEqual(blobCalls[0].path, ["study-files/" + source, "study-files/" + OWNER + "/copy.pdf"]);
  assert.equal(blobCalls[0].options.allowOverwrite, false);
});

test("signed URLs delegate one exact GET path for at most one hour", async () => {
  blobCalls = []; const start = Date.now();
  const result = await service.signedPrivateFile(context, "recordings", OWNER + "/audio.webm", 86400);
  assert.deepEqual(result, { signedUrl: "https://private.example.test/scoped-signed-file" });
  const issue = blobCalls.find(call => call.method === "issueSignedToken")!;
  const sign = blobCalls.find(call => call.method === "presignUrl")!;
  assert.equal(issue.options.pathname, "recordings/" + OWNER + "/audio.webm");
  assert.deepEqual(issue.options.operations, ["get"]);
  assert.ok(issue.options.validUntil >= start + 3599_000 && issue.options.validUntil <= Date.now() + 3600_000);
  assert.equal(sign.options.pathname, issue.options.pathname);
  assert.equal(sign.options.access, "private"); assert.equal(sign.options.operation, "get");
  assert.equal(sign.options.validUntil, issue.options.validUntil);
  assert.doesNotMatch(JSON.stringify(result), /secret-signing|secret-delegation|valid-owner/);
});

test("upload tokens require valid auth, owned exact pathname, size/MIME constraints and short expiry", async () => {
  const payload = { bucket: "study-files", path: OWNER + "/a.pdf", contentType: "application/pdf", upsert: true };
  const body = { type: "blob.generate-client-token", payload: { pathname: "study-files/" + payload.path, clientPayload: JSON.stringify(payload), multipart: true } };
  blobCalls = []; tokenOptions = null;
  assert.equal((await uploadPOST(request("upload", body, "forged-owner"))).status, 401);
  assert.equal(blobCalls.length, 0);
  assert.equal((await uploadPOST(request("upload", { ...body, payload: { ...body.payload, pathname: "study-files/" + FRIEND + "/a.pdf" } }))).status, 400);
  assert.equal(blobCalls.length, 0);
  const before = Date.now();
  assert.equal((await uploadPOST(request("upload", body))).status, 200);
  assert.equal(tokenOptions.maximumSizeInBytes, MAX_FILE_BYTES);
  assert.equal(tokenOptions.allowOverwrite, true); assert.equal(tokenOptions.addRandomSuffix, false);
  assert.deepEqual(tokenOptions.allowedContentTypes, ["application/pdf"]);
  assert.ok(tokenOptions.validUntil > before && tokenOptions.validUntil <= Date.now() + 600_000);
  const avatarBody = { ...body, payload: { ...body.payload, pathname: "profile-avatars/" + OWNER + "/avatar.jpg", clientPayload: JSON.stringify({ bucket: "profile-avatars", path: OWNER + "/avatar.jpg", contentType: "image/jpeg", upsert: false }) } };
  assert.equal((await uploadPOST(request("upload", avatarBody))).status, 200);
  assert.equal(tokenOptions.maximumSizeInBytes, MAX_AVATAR_BYTES);
  assert.equal(tokenOptions.allowOverwrite, false);
  assert.deepEqual(tokenOptions.allowedContentTypes, ["image/jpeg", "image/png", "image/webp"]);
  assert.equal((await uploadPOST(request("upload", { ...avatarBody, payload: { ...avatarBody.payload, clientPayload: JSON.stringify({ bucket: "profile-avatars", path: OWNER + "/avatar.jpg", contentType: "image/svg+xml" }) } }))).status, 400);
});

test("routes reject forged ownership and fail closed on the legacy backend", async () => {
  blobCalls = [];
  const response = await operationsPOST(request("operations", { action: "remove", bucket: "recordings", user_id: FRIEND, paths: [FRIEND + "/audio.webm"] }));
  assert.equal(response.status, 403); assert.equal(blobCalls.length, 0);
  backend = "supabase";
  try {
    assert.equal((await readGET(request("read?bucket=recordings&path=" + OWNER + "/audio.webm"))).status, 503);
    assert.equal((await uploadPOST(request("upload", {}))).status, 503);
    assert.equal((await operationsPOST(request("operations", {}))).status, 503);
  } finally { backend = "neondb"; }
  assert.equal(blobCalls.length, 0);
});

test("cookie read verifies JWT, safely streams general files, and does not accept URL tokens", async () => {
  blobCalls = []; blobContentType = "text/html"; cookieToken = "valid-owner";
  const response = await readGET(request("read?bucket=study-files&path=" + OWNER + "/file.html", undefined, null));
  assert.equal(response.status, 200); assert.equal(await response.text(), "file");
  assert.match(response.headers.get("content-disposition") || "", /^attachment;/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") || "", /sandbox/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  cookieToken = "forged-owner";
  assert.equal((await readGET(request("read?bucket=study-files&path=" + OWNER + "/a.pdf&token=valid-owner", undefined, null))).status, 401);
  cookieToken = "valid-owner"; blobContentType = "application/pdf";
  assert.equal((await operationsPOST(request("operations", { action: "remove", bucket: "study-files", paths: [OWNER + "/a.pdf"] }, null, { Origin: "https://attacker.example.test" }))).status, 403);
  assert.equal(blobCalls.length, 1);
});

test("server adapter preserves Blob download result and sanitizes provider errors", async () => {
  const storage = serverStorage.createServerAppStorage(async () => "valid-owner");
  const downloaded = await storage.from("recordings").download(OWNER + "/audio.webm");
  assert.equal(downloaded.error, null); assert.ok(downloaded.data instanceof Blob);
  assert.equal(await downloaded.data!.text(), "file");
  const badAuth = await serverStorage.createServerAppStorage(async () => "forged-owner").from("study-files").download(OWNER + "/a.pdf");
  assert.match(badAuth.error!.message, /Login/); assert.doesNotMatch(badAuth.error!.message, /provider|secret/);
  const originalPut = fakeBlob.put;
  fakeBlob.put = async () => { throw new Error("provider leaked BLOB_READ_WRITE_TOKEN=secret"); };
  try {
    const result = await storage.from("study-files").upload(OWNER + "/a.pdf", "file");
    assert.equal(result.data, null); assert.doesNotMatch(result.error!.message, /TOKEN|secret|provider/);
  } finally { fakeBlob.put = originalPut; }
});

test("invalid explicit Authorization cannot fall back to a valid cookie", async () => {
  cookieToken = "valid-owner"; blobCalls = [];
  for (const authorization of ["Basic valid-owner", "Bearer", "Bearer invalid token", "Bearer forged-owner"]) {
    const response = await readGET(request("read?bucket=study-files&path=" + OWNER + "/a.pdf", undefined, null, { Authorization: authorization }));
    assert.equal(response.status, 401);
  }
  assert.equal(blobCalls.length, 0);
  const noOrigin = await operationsPOST(request("operations", { action: "remove", bucket: "study-files", paths: [OWNER + "/a.pdf"] }, null));
  assert.equal(noOrigin.status, 403);
  assert.equal(blobCalls.length, 0);
});

test("oversized avatar files and authorization JSON are rejected before Blob mutation", async () => {
  blobCalls = [];
  await assert.rejects(service.uploadPrivateFile(context, "profile-avatars", OWNER + "/avatar.jpg", new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)]), { contentType: "image/jpeg" }), (error: any) => error.status === 413);
  for (const post of [operationsPOST, uploadPOST]) {
    const response = await post(request("operations", { padding: "x".repeat(17 * 1024) }));
    assert.equal(response.status, 413);
  }
  assert.equal(blobCalls.length, 0);
});

test("browser upload uses a scoped token route and preserves private result contracts", async t => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; options: any }> = [];
  globalThis.fetch = (async (url: any, options: any) => {
    requests.push({ url: String(url), options });
    return Response.json({ data: { signedUrl: "https://private.example.test/signed" } });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  blobCalls = [];
  const storage = browserStorage.createAppStorage(async () => "valid-owner");
  const uploaded = await storage.from("study-files").upload(OWNER + "/a.pdf", new Blob(["file"]), { contentType: "application/pdf" });
  assert.equal(uploaded.error, null); assert.equal(uploaded.data!.path, OWNER + "/a.pdf");
  const call = blobCalls[0];
  assert.equal(call.method, "clientUpload"); assert.equal(call.path, "study-files/" + OWNER + "/a.pdf");
  assert.equal(call.options.access, "private"); assert.equal(call.options.multipart, true);
  assert.equal(call.options.handleUploadUrl, "/api/files/upload");
  assert.equal(call.options.headers.Authorization, "Bearer valid-owner");
  assert.equal(JSON.parse(call.options.clientPayload).upsert, false);
  const signed = await storage.from("study-files").createSignedUrl(OWNER + "/a.pdf", 3600);
  assert.equal(signed.error, null); assert.equal(signed.data!.signedUrl, "https://private.example.test/signed");
  assert.equal(requests[0].url, "/api/files/operations");
  assert.equal(requests[0].options.headers.Authorization, "Bearer valid-owner");
  const publicUrl = storage.from("profile-avatars").getPublicUrl(OWNER + "/avatar.jpg").data.publicUrl;
  assert.match(publicUrl, /^\/api\/files\/read\?/); assert.doesNotMatch(publicUrl, /valid-owner|token=/);
});
