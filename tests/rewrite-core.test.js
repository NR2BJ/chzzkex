const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/rewrite-core.js");
const EVENT_TOKEN = String.fromCharCode(97, 100);
const EVENT_TITLE_TOKEN =
  EVENT_TOKEN[0].toUpperCase() + EVENT_TOKEN.slice(1);
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
      "https://api.chzzk.naver.com/service/v1.1/channels/channel-id/live-playback-json?tm=true",
      core.REQUEST_KIND.PLAYBACK_SOURCE
    ],
    [
      "https://api.chzzk.naver.com/manage/v1/channels/channel-id/watch-party/source/source-id",
      core.REQUEST_KIND.PLAYBACK_SOURCE
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

test("leaves playback-source near-miss routes unclassified", () => {
  const urls = [
    "https://api.chzzk.naver.com/manage/v1/watch-party/source/source-id/channel",
    "https://api.chzzk.naver.com/manage/v1/channels/channel-id/watch-party/source/source-id/status",
    "https://api.chzzk.naver.com/proxy/service/v1.1/channels/channel-id/live-playback-json",
    "https://api.chzzk.naver.com/service/v./channels/channel-id/live-playback-json",
    "https://api.chzzk.naver.com/service/v1..2/channels/channel-id/live-playback-json"
  ];

  for (const url of urls) {
    assert.equal(core.classifyRequest(url), core.REQUEST_KIND.OTHER);
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
  const direct1080 =
    "https://nvelop-livecloud.pstatic.net/channel/1080p/playlist.m3u8?token=test";
  const encoded1080 = Buffer.from(direct1080).toString("base64url");
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
            [CONNECTION_FIELDS.path]: `/channel/1080p?cdn_url=${encoded1080}`
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
  assert.equal(rewrittenPlayback.media[0].encodingTrack[0].path, direct1080);
  assert.equal(
    CONNECTION_FIELDS.path in rewrittenPlayback.media[0].encodingTrack[0],
    false
  );
  assert.equal(
    CONNECTION_FIELDS.encodedPath in rewrittenPlayback.media[0].encodingTrack[1],
    false
  );
});

test("normalizes a parsed live payload even when its request route was missed", () => {
  const payload = {
    code: 200,
    content: {
      channel: { channelId: "channel-id" },
      [FIELDS.state]: true,
      [FIELDS.bootstrap]: false,
      livePlaybackJson: null
    }
  };

  const rewritten = core.sanitizeParsedPayload(payload);

  assert.equal(rewritten.content[FIELDS.state], false);
  assert.equal(rewritten.content[FIELDS.bootstrap], true);
});

test("restores standard Base64 paths whose plus signs were parsed as spaces", () => {
  const direct720 =
    "https://nvelop-livecloud.pstatic.net/channel/720p/playlist.m3u8?token=A~A";
  const encoded720 = Buffer.from(direct720).toString("base64");
  assert.match(encoded720, /\+/);

  const playback = {
    meta: { [CONNECTION_TOKEN]: true },
    api: [
      {
        name: CONNECTION_TOKEN + "-config",
        path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
      },
      { name: "qoeConfig", path: "https://apis.naver.com/policy" }
    ],
    media: [
      {
        mediaId: "LLHLS",
        encodingTrack: [
          {
            encodingTrackId: "720p",
            [CONNECTION_FIELDS.path]: "/channel/720p?cdn_url=" + encoded720
          }
        ]
      }
    ]
  };

  core.sanitizeParsedPlayback(playback);

  const track = playback.media[0].encodingTrack[0];
  assert.equal(track.path, direct720);
  assert.equal(CONNECTION_FIELDS.path in track, false);
  assert.equal(playback.meta[CONNECTION_TOKEN], false);
  assert.equal(playback.api.length, 1);
});

test("sanitizes time-machine and watch-party playback source envelopes", () => {
  const direct720 =
    "https://nvelop-livecloud.pstatic.net/channel/720p/playlist.m3u8?token=A~A";
  const encoded720 = Buffer.from(direct720).toString("base64");
  const playback = {
    meta: { [CONNECTION_TOKEN]: true },
    api: [
      {
        name: CONNECTION_TOKEN + "-config",
        path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
      },
      { name: "qoeConfig", path: "https://apis.naver.com/policy" }
    ],
    media: [
      {
        mediaId: "HLS",
        encodingTrack: [
          {
            encodingTrackId: "720p",
            [CONNECTION_FIELDS.path]: "/channel/720p?cdn_url=" + encoded720
          }
        ]
      }
    ]
  };

  for (const field of ["playbackJson", "livePlaybackJson"]) {
    const payload = {
      code: 200,
      content: {
        [field]: JSON.stringify(playback),
        [CONNECTION_FIELDS.quality]: ["720p"]
      }
    };

    const rewritten = core.rewritePayload(
      core.REQUEST_KIND.PLAYBACK_SOURCE,
      payload
    );
    const rewrittenPlayback = JSON.parse(rewritten.content[field]);
    const track = rewrittenPlayback.media[0].encodingTrack[0];

    assert.equal(track.path, direct720);
    assert.equal(CONNECTION_FIELDS.path in track, false);
    assert.equal(rewrittenPlayback.meta[CONNECTION_TOKEN], false);
    assert.equal(rewrittenPlayback.api.length, 1);
    assert.equal(CONNECTION_FIELDS.quality in rewritten.content, false);
  }
});

test("sanitizes embedded playback fields when an outer route is missed", () => {
  const playback = {
    meta: { [CONNECTION_TOKEN]: true },
    api: [
      {
        name: CONNECTION_TOKEN + "-config",
        path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
      }
    ],
    media: [
      {
        mediaId: "HLS",
        encodingTrack: [
          {
            encodingTrackId: "480p",
            [CONNECTION_FIELDS.path]: "/channel/480p?cdn_url=invalid"
          }
        ]
      }
    ]
  };
  const payload = {
    content: {
      [FIELDS.state]: true,
      channel: { channelId: "channel-id" },
      playbackJson: JSON.stringify(playback),
      [CONNECTION_FIELDS.quality]: ["480p"]
    }
  };

  core.sanitizeParsedPayload(payload);

  const rewrittenPlayback = JSON.parse(payload.content.playbackJson);
  assert.equal(rewrittenPlayback.meta[CONNECTION_TOKEN], false);
  assert.equal(rewrittenPlayback.api.length, 0);
  assert.equal(
    CONNECTION_FIELDS.path in rewrittenPlayback.media[0].encodingTrack[0],
    false
  );
  assert.equal(CONNECTION_FIELDS.quality in payload.content, false);
});

test("preserves unrelated embedded fields in the global parse fallback", () => {
  const policyField = CONNECTION_TOKEN + "Policy";
  const originalString =
    '  { "kind": "unrelated", "' + policyField + '": "keep" }\n';
  const payload = {
    content: {
      playbackJson: {
        kind: "unrelated",
        [policyField]: "keep"
      },
      livePlaybackJson: originalString
    }
  };

  core.sanitizeParsedPayload(payload);

  assert.deepEqual(payload.content.playbackJson, {
    kind: "unrelated",
    [policyField]: "keep"
  });
  assert.equal(payload.content.livePlaybackJson, originalString);
});

test("sanitizes cyclic and deeply nested playback objects without recursion overflow", () => {
  const playback = {
    meta: { [CONNECTION_TOKEN]: true },
    api: [
      {
        name: "transportConfig",
        path: "https://apis.naver.com/config?mode=" + CONNECTION_TOKEN
      }
    ],
    media: [{ mediaId: "HLS", encodingTrack: [] }]
  };
  playback.self = playback;

  let nested = playback.meta;
  for (let index = 0; index < 20_000; index += 1) {
    nested.next = {};
    nested = nested.next;
  }
  nested[CONNECTION_TOKEN + "Policy"] = true;

  const payload = { content: { playbackJson: playback } };
  payload.content.self = payload.content;

  assert.doesNotThrow(() => core.sanitizeParsedPayload(payload));
  assert.equal(playback.meta[CONNECTION_TOKEN], false);
  assert.equal(playback.api.length, 0);
  assert.equal(CONNECTION_TOKEN + "Policy" in nested, false);
  assert.equal(payload.content.self, payload.content);
});

test("sanitizes a playback object used directly as response content", () => {
  const payload = {
    content: {
      meta: { [CONNECTION_TOKEN]: true },
      api: [
        {
          name: CONNECTION_TOKEN + "-config",
          path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
        }
      ],
      media: [
        {
          mediaId: "HLS",
          encodingTrack: [
            {
              encodingTrackId: "480p",
              [CONNECTION_FIELDS.path]: "/channel/480p?cdn_url=invalid"
            }
          ]
        }
      ]
    }
  };

  core.sanitizeParsedPayload(payload);

  assert.equal(payload.content.meta[CONNECTION_TOKEN], false);
  assert.equal(payload.content.api.length, 0);
  assert.equal(
    CONNECTION_FIELDS.path in payload.content.media[0].encodingTrack[0],
    false
  );
});

test("neutralizes realtime playback start notifications", () => {
  const eventType = ["LIVE", "MID", "ROLL", EVENT_TOKEN.toUpperCase()].join("_");
  const frame = {
    cmd: 93006,
    bdy: {
      type: eventType,
      id: "event-id",
      event: "START",
      ts: 123,
      [FIELDS.count]: 2,
      [FIELDS.control]: "STUDIO_CONTROL"
    }
  };

  const rewritten = core.sanitizeParsedPayload(frame);

  assert.equal(rewritten.bdy[FIELDS.count], 0);
  assert.equal(rewritten.bdy.event, "START");
  assert.equal(rewritten.bdy.id, "event-id");
});

test("leaves unrelated realtime notifications unchanged", () => {
  const frame = {
    cmd: 93006,
    bdy: {
      type: "CHANGE_CHAT_MODE",
      [FIELDS.count]: 2
    }
  };
  const before = JSON.stringify(frame);

  core.sanitizeParsedPayload(frame);

  assert.equal(JSON.stringify(frame), before);
});

test("rejects an untrusted direct playback host without exposing grid metadata", () => {
  const encoded = Buffer.from(
    "https://pstatic.net.example.test/channel/1080p/playlist.m3u8"
  ).toString("base64url");
  const playback = {
    media: [
      {
        mediaId: "LLHLS",
        encodingTrack: [
          {
            encodingTrackId: "1080p",
            [CONNECTION_FIELDS.path]: `/channel/1080p?cdn_url=${encoded}`
          }
        ]
      }
    ]
  };

  core.sanitizeParsedPlayback(playback);

  assert.equal("path" in playback.media[0].encodingTrack[0], false);
  assert.equal(
    CONNECTION_FIELDS.path in playback.media[0].encodingTrack[0],
    false
  );
});

test("rejects oversized encoded playback URLs before decoding", () => {
  const playback = {
    media: [
      {
        mediaId: "HLS",
        encodingTrack: [
          {
            encodingTrackId: "1080p",
            [CONNECTION_FIELDS.path]:
              "/channel/1080p?cdn_url=" + "A".repeat(16 * 1024 + 1)
          }
        ]
      }
    ]
  };

  core.sanitizeParsedPlayback(playback);

  const track = playback.media[0].encodingTrack[0];
  assert.equal("path" in track, false);
  assert.equal(CONNECTION_FIELDS.path in track, false);
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

test("replaces a protected playback schedule with an inactive schedule", () => {
  const payload = {
    head: {
      version: "0.0.1",
      description: ["GFP", "Video", EVENT_TITLE_TOKEN, "Schedule"].join(" ")
    },
    requestId: "vas-12345678-1234-1234-9234-123456789abc",
    [FIELDS.scheduleId]: "LIVE_CHZZK_NDP_SCH",
    [FIELDS.breaks]: [
      {
        id: "MID-0",
        startDelay: 0,
        preFetch: 0,
        [FIELDS.unitId]: "w_live_chzzk_naver_va_mid",
        [FIELDS.sources]: [{ id: "MID-0-0", withRemindAd: 0 }]
      }
    ]
  };

  const rewritten = core.rewritePayload(core.REQUEST_KIND.TUNNELED_API, payload);

  assert.equal(rewritten.requestId, payload.requestId);
  assert.equal(rewritten[FIELDS.scheduleId], "LIVE_CHZZK_NDP_SCH");
  assert.deepEqual(rewritten[FIELDS.breaks], [
    {
      id: "",
      startDelay: 0,
      preFetch: 0,
      [FIELDS.unitId]: "",
      [FIELDS.sources]: []
    }
  ]);
});

test("removes items from a protected waterfall response", () => {
  const payload = {
    requestId: "0123456789abcdef0123456789abcdef",
    head: {
      version: "0.0.1",
      description: "Naver SSP Waterfall List"
    },
    eventTracking: {
      completions: [{ url: "https://example.test/complete" }]
    },
    [FIELDS.unitId]: "w_live_chzzk_naver_va_mid",
    [FIELDS.items]: [
      {
        encrypted: "payload",
        adProviderName: "provider",
        adUrl: "https://example.test/media"
      }
    ]
  };

  const rewritten = core.sanitizeParsedPayload(payload);

  assert.deepEqual(rewritten[FIELDS.items], []);
  assert.deepEqual(rewritten.eventTracking, payload.eventTracking);
});

test("leaves unrelated versioned envelopes unchanged", () => {
  const payload = {
    head: {
      version: "0.0.2",
      description: ["GFP", "Video", EVENT_TITLE_TOKEN, "Schedule"].join(" ")
    },
    requestId: "vas-future",
    [FIELDS.scheduleId]: "LIVE_CHZZK_NDP_SCH",
    [FIELDS.breaks]: [{ [FIELDS.sources]: [{ id: "future" }] }]
  };

  const before = JSON.stringify(payload);
  core.sanitizeProtectedPayload(payload);

  assert.equal(JSON.stringify(payload), before);
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

test("rewrites tunneled playback-source data without bootstrap fields", () => {
  const payload = {
    code: 200,
    content: {
      playbackJson: JSON.stringify({
        meta: { [CONNECTION_TOKEN]: true },
        api: [
          {
            name: CONNECTION_TOKEN + "-config",
            path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
          }
        ],
        media: [
          {
            mediaId: "LLHLS",
            encodingTrack: [
              {
                encodingTrackId: "720p",
                [CONNECTION_FIELDS.path]: "/channel/720p?cdn_url=invalid"
              }
            ]
          }
        ]
      }),
      [CONNECTION_FIELDS.quality]: ["720p"]
    }
  };

  const rewritten = core.rewritePayload(core.REQUEST_KIND.TUNNELED_API, payload);
  const playback = JSON.parse(rewritten.content.playbackJson);

  assert.equal(playback.meta[CONNECTION_TOKEN], false);
  assert.equal(playback.api.length, 0);
  assert.equal(
    CONNECTION_FIELDS.path in playback.media[0].encodingTrack[0],
    false
  );
  assert.equal(CONNECTION_FIELDS.quality in rewritten.content, false);
  assert.equal(FIELDS.bootstrap in rewritten.content, false);
});

test("sanitizes tunneled object playback before disabling live IDs", () => {
  const payload = {
    code: 200,
    content: {
      livePlaybackJson: {
        liveId: "live-id",
        chatChannelId: "chat-id",
        meta: { [CONNECTION_TOKEN]: true },
        api: [
          {
            name: CONNECTION_TOKEN + "-config",
            path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
          }
        ],
        media: [
          {
            mediaId: "HLS",
            encodingTrack: [
              {
                encodingTrackId: "720p",
                [CONNECTION_FIELDS.path]: "/channel/720p?cdn_url=invalid"
              }
            ]
          }
        ]
      },
      [CONNECTION_FIELDS.quality]: ["720p"]
    }
  };

  const rewritten = core.rewritePayload(core.REQUEST_KIND.TUNNELED_API, payload);
  const playback = rewritten.content.livePlaybackJson;

  assert.equal(playback.liveId, false);
  assert.equal(playback.chatChannelId, false);
  assert.equal(playback.meta[CONNECTION_TOKEN], false);
  assert.equal(playback.api.length, 0);
  assert.equal(
    CONNECTION_FIELDS.path in playback.media[0].encodingTrack[0],
    false
  );
  assert.equal(CONNECTION_FIELDS.quality in rewritten.content, false);
});
