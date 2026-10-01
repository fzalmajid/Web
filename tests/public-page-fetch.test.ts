import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, fetchPublicPage } from "../lib/publicPageFetch";
test("page fetch blocks private, loopback and mapped addresses",async()=>{
  for(const ip of ["127.0.0.1","10.0.0.1","100.64.0.1","169.254.169.254","172.16.0.1","192.168.1.1","::1","::ffff:127.0.0.1","fc00::1","2001:db8::1"])assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress("8.8.8.8"),true);await assert.rejects(fetchPublicPage("http://127.0.0.1/"));
});
