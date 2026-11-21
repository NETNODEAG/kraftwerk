import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { remoteAuthEnv, setRemoteAuth, withoutCredentials } from "../../src/core/git.js";
import { parseJoinLink } from "../../src/server/join.js";

describe("kraftwerk sync helpers", () => {
  it("a remote URL is shown without the credentials in it", () => {
    assert.equal(withoutCredentials("https://m1:s3cret@cloud.example/git/ws_a.git"), "https://cloud.example/git/ws_a.git");
    assert.equal(withoutCredentials("https://token@github.com/acme/x.git"), "https://github.com/acme/x.git");
    assert.equal(withoutCredentials("git@github.com:acme/x.git"), "git@github.com:acme/x.git");
    assert.equal(withoutCredentials("/srv/git/x.git"), "/srv/git/x.git");
  });

  it("git gets the machine's key as a URL-scoped header, after any GIT_CONFIG_* already set", () => {
    setRemoteAuth(() => ({}));
    assert.deepEqual(remoteAuthEnv({}), {});
    setRemoteAuth(() => ({ "https://cloud.example/git/": "Authorization: Basic abc" }));
    assert.deepEqual(remoteAuthEnv({}), {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://cloud.example/git/.extraHeader",
      GIT_CONFIG_VALUE_0: "Authorization: Basic abc",
    });
    assert.deepEqual(remoteAuthEnv({ GIT_CONFIG_COUNT: "2" }), {
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_2: "http.https://cloud.example/git/.extraHeader",
      GIT_CONFIG_VALUE_2: "Authorization: Basic abc",
    });
    setRemoteAuth(() => ({}));
  });

  it("a join link names its cloud and code; a bare code uses this machine's cloud", () => {
    assert.deepEqual(parseJoinLink("https://srv.example.cloud/join/XKQ7-2MPD-HH3A"), { origin: "https://srv.example.cloud", code: "XKQ7-2MPD-HH3A" });
    assert.deepEqual(parseJoinLink(" http://127.0.0.1:19911/join/XKQ7-2MPD-HH3A?x=1 "), { origin: "http://127.0.0.1:19911", code: "XKQ7-2MPD-HH3A" });
    assert.deepEqual(parseJoinLink("xkq72mpdhh3a"), { origin: null, code: "xkq72mpdhh3a" });
    assert.throws(() => parseJoinLink("https://example.com/somewhere"), /not a join link/);
  });
});
