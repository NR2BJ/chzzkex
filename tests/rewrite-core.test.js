const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/rewrite-core.js");
const EVENT_TOKEN = String.fromCharCode(97, 100);
const CONNECTION_TOKEN = String.fromCharCode(112, 50, 112);
const FIELDS = core.RUNTIME_FIELDS;
const CONNECTION_FIELDS = Object.freeze({
  quality: `${CONNECTION_TOKEN}Quality`,
  path: `${CONNECTION_TOKEN}Path`,
  encodedPath: `${CONNECTION_TOKEN}PathUrlEncoding`
});

test("classifies the current CHZZK playback endpoints", () => {
  const cases = [
    [
      `https://api.chzzk.naver.com/service/v1/${EVENT_TOKEN}/display-status?pgType=CHZZK_LIVE`,
      core.REQUEST_KIND.DISPLAY_STATUS
    ],
    [
      `https://api.chzzk.naver.com/${EVENT_TOKEN}-polling/v1/lives/20145400/${EVENT_TOKEN}?ts=123`,
      core.REQUEST_KIND.PLAYBACK_EVENT
    ],
    [
      `https://api.chzzk.naver.com/service/v1/lives/20145400/${EVENT_TOKEN}s/current`,
      core.REQUEST_KIND.CURRENT_EVENT
    ],
    [
      "https://api.chzzk.naver.com/service/v2/channels/channel-id/live-detail?dt=PC",
      core.REQUEST_KIND.LIVE_DETAIL
    ],
    [
      "https://api.chzzk.naver.com/polling/v3.1/channels/channel-id/live-status",
      core.REQUEST_KIND.LIVE_STATUS
    ],
    [
      "https://api.chzzk.naver.com/service/t/opaque-token",
      core.REQUEST_KIND.TUNNELED_API
    ]
  ];

  for (const [url, expected] of cases) {
    assert.equal(core.classifyRequest(url), expected);
  }
});

test("always handles classified playback requests", () => {
  const handledKinds = Object.values(core.REQUEST_KIND).filter(
    (kind) => kind !== core.REQUEST_KIND.OTHER
  );
  for (const kind of handledKinds) {
    assert.equal(core.shouldRewrite(kind), true);
  }
  assert.equal(core.shouldRewrite(core.REQUEST_KIND.OTHER), false);
  assert.equal(core.shouldShortCircuit(core.REQUEST_KIND.DISPLAY_STATUS), true);
  assert.equal(core.shouldShortCircuit(core.REQUEST_KIND.LIVE_DETAIL), false);
});

test("returns the inactive display-status shape", () => {
  const original = {
    code: 200,
    message: null,
    content: {
      [FIELDS.display]: {
        [FIELDS.prePhase]: true,
        [FIELDS.midPhase]: true
      }
    }
  };

  const rewritten = core.rewritePayload(
    core.REQUEST_KIND.DISPLAY_STATUS,
    original
  );

  assert.deepEqual(rewritten.content[FIELDS.display], {
    [FIELDS.prePhase]: false,
    [FIELDS.midPhase]: false
  });
});

test("clears top-level playback event fields", () => {
  const rewritten = core.rewritePayload(
    core.REQUEST_KIND.PLAYBACK_EVENT,
    {
      id: "event-id",
      event: "START",
      ts: 123,
      [FIELDS.count]: 2,
      [FIELDS.control]: "INTEGRATION_CONTROL"
    }
  );

  assert.deepEqual(rewritten, {
    id: null,
    event: null,
    ts: null,
    [FIELDS.count]: null,
    [FIELDS.control]: "INTEGRATION_CONTROL"
  });
});

test("clears the current playback event response", () => {
  const rewritten = core.rewritePayload(
    core.REQUEST_KIND.CURRENT_EVENT,
    {
      code: 200,
      message: null,
      content: {
        id: "event-id",
        event: "START",
        ts: 123,
        [FIELDS.count]: 1,
        [FIELDS.control]: "STUDIO_CONTROL"
      }
    }
  );

  assert.deepEqual(rewritten.content, {
    id: null,
    event: null,
    ts: null,
    [FIELDS.count]: null,
    [FIELDS.control]: "STUDIO_CONTROL"
  });
});

test("normalizes playback bootstrap without changing quality tracks", () => {
  const playback = {
    meta: { [CONNECTION_TOKEN]: true },
    api: [
      {
        name: `${CONNECTION_TOKEN}-config`,
        path: `https://apis.naver.com/${CONNECTION_TOKEN}/config`
      },
      { name: "qoeConfig", path: "https://apis.naver.com/policy" }
    ],
    media: [
      {
        mediaId: "HLS",
        encodingTrack: [
          {
            encodingTrackId: "1080p",
            [CONNECTION_FIELDS.path]: `${CONNECTION_TOKEN}-1080`
          },
          {
            encodingTrackId: "480p",
            [CONNECTION_FIELDS.encodedPath]: `${CONNECTION_TOKEN}-480`
          }
        ]
      }
    ]
  };
  const payload = {
    code: 200,
    content: {
      [FIELDS.state]: true,
      [FIELDS.bootstrap]: false,
      [CONNECTION_FIELDS.quality]: ["1080p"],
      livePlaybackJson: JSON.stringify(playback)
    }
  };

  const rewritten = core.rewritePayload(core.REQUEST_KIND.LIVE_DETAIL, payload);
  const rewrittenPlayback = JSON.parse(rewritten.content.livePlaybackJson);

  assert.equal(rewritten.content[FIELDS.bootstrap], true);
  assert.equal(rewritten.content[FIELDS.state], false);
  assert.equal(CONNECTION_FIELDS.quality in rewritten.content, false);
  assert.deepEqual(
    rewrittenPlayback.media[0].encodingTrack.map((track) => track.encodingTrackId),
    ["1080p", "480p"]
  );
  assert.equal(rewrittenPlayback.meta[CONNECTION_TOKEN], false);
  assert.equal(rewrittenPlayback.api.length, 1);
  assert.equal(
    CONNECTION_FIELDS.path in rewrittenPlayback.media[0].encodingTrack[0],
    false
  );
  assert.equal(
    CONNECTION_FIELDS.encodedPath in rewrittenPlayback.media[0].encodingTrack[1],
    false
  );
});

test("rewrites tunneled playback decisions by response shape", () => {
  const payload = {
    code: 200,
    message: null,
    content: {
      [FIELDS.display]: {
        [FIELDS.prePhase]: true,
        [FIELDS.midPhase]: true
      }
    }
  };

  const rewritten = core.rewritePayload(core.REQUEST_KIND.TUNNELED_API, payload);

  assert.deepEqual(rewritten.content[FIELDS.display], {
    [FIELDS.prePhase]: false,
    [FIELDS.midPhase]: false
  });
});

test("rewrites tunneled playback bootstrap data without replacing tracks", () => {
  const payload = {
    code: 200,
    content: {
      [FIELDS.bootstrap]: false,
      livePlaybackJson: JSON.stringify({
        api: [
          {
            name: `${CONNECTION_TOKEN}-config`,
            path: `https://apis.naver.com/${CONNECTION_TOKEN}/config`
          },
          { name: "qoeConfig", path: "https://apis.naver.com/policy" }
        ],
        media: [
          {
            encodingTrack: [
              { encodingTrackId: "1080p" },
              { encodingTrackId: "480p" }
            ]
          }
        ]
      })
    }
  };

  const rewritten = core.rewritePayload(core.REQUEST_KIND.TUNNELED_API, payload);
  const playback = JSON.parse(rewritten.content.livePlaybackJson);

  assert.equal(rewritten.content[FIELDS.bootstrap], true);
  assert.deepEqual(
    playback.media[0].encodingTrack.map((track) => track.encodingTrackId),
    ["1080p", "480p"]
  );
  assert.equal(playback.api.length, 1);
});
